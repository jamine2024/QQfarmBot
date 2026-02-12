import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Env } from "./env.js";
import { asyncHandler } from "./http/asyncHandler.js";
import { errorMiddleware } from "./http/errorMiddleware.js";
import { httpError } from "./http/httpErrors.js";
import { requireAuth, requireRole } from "./auth/authMiddleware.js";
import { signAccessToken } from "./auth/jwt.js";
import { toPublicUser } from "./auth/types.js";
import type { UserStore } from "./auth/userStore.js";
import type { LogBuffer } from "./logging/logBuffer.js";
import type { ConfigStore } from "./runtime/configStore.js";
import type { CoreSnapshot } from "./runtime/runtimeState.js";
import { BotController } from "./bot/botController.js";
import type { RuntimeConfig } from "./runtime/runtimeState.js";
import type { StatsStore } from "./runtime/statsStore.js";

export type Services = {
  env: Env;
  projectRoot: string;
  userStore: UserStore;
  logBuffer: LogBuffer;
  configStore: ConfigStore;
  statsStore: StatsStore;
  bot: BotController;
  getWsClientCount: () => number;
  getRuntimeConfig: () => RuntimeConfig;
  shutdown: () => Promise<void>;
};

export function createApp(services: Services): express.Express {
  const app = express();

  app.use(
    cors({
      origin: true,
      credentials: false,
    })
  );
  app.use(express.json({ limit: "1mb" }));

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  app.post(
    "/api/auth/login",
    asyncHandler(async (req, res) => {
      const bootstrapRequired = await services.userStore.needsBootstrap();
      if (bootstrapRequired) throw httpError(409, "BOOTSTRAP_REQUIRED");
      const body = z
        .object({
          username: z.string().min(1),
          password: z.string().min(1),
        })
        .parse(req.body);

      const user = await services.userStore.authenticate(body.username, body.password);
      if (!user) throw httpError(401, "INVALID_CREDENTIALS");
      const publicUser = toPublicUser(user);
      const token = signAccessToken(services.env.JWT_SECRET, publicUser);
      res.json({ token, user: publicUser });
    })
  );

  app.get(
    "/api/auth/bootstrap",
    asyncHandler(async (_req, res) => {
      const required = await services.userStore.needsBootstrap();
      res.json({ required });
    })
  );

  app.post(
    "/api/auth/bootstrap",
    asyncHandler(async (req, res) => {
      const required = await services.userStore.needsBootstrap();
      if (!required) throw httpError(409, "ALREADY_BOOTSTRAPPED");
      const body = z
        .object({
          username: z.string().min(3).max(32),
          password: z.string().min(8).max(128),
        })
        .parse(req.body);
      const user = await services.userStore.bootstrapAdmin(body.username, body.password);
      const publicUser = toPublicUser(user);
      const token = signAccessToken(services.env.JWT_SECRET, publicUser);
      res.json({ token, user: publicUser });
    })
  );

  app.get(
    "/api/auth/me",
    requireAuth(services.env.JWT_SECRET),
    asyncHandler(async (req, res) => {
      res.json({ user: req.auth });
    })
  );

  app.get(
    "/api/users",
    requireAuth(services.env.JWT_SECRET),
    requireRole("admin"),
    asyncHandler(async (_req, res) => {
      const users = await services.userStore.listUsers();
      res.json({ users: users.map(toPublicUser) });
    })
  );

  app.get(
    "/api/config",
    requireAuth(services.env.JWT_SECRET),
    asyncHandler(async (_req, res) => {
      const config = await services.configStore.get();
      res.json({ config });
    })
  );

  app.put(
    "/api/config",
    requireAuth(services.env.JWT_SECRET),
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const config = await services.configStore.set(req.body);
      res.json({ config });
    })
  );

  app.get(
    "/api/bot/status",
    requireAuth(services.env.JWT_SECRET),
    asyncHandler(async (_req, res) => {
      res.json({ status: services.bot.getStatus() });
    })
  );

  app.post(
    "/api/bot/start",
    requireAuth(services.env.JWT_SECRET),
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const body = z.object({ code: z.string().min(5) }).parse(req.body);
      const didReset = await services.statsStore.resetIfCodeChanged(body.code);
      if (didReset) {
        await services.logBuffer.append({ level: "info", scope: "系统", message: "检测到 code 变更，统计已重置" });
      }
      const config = await services.configStore.get();
      await services.bot.start(BotController.toStartInput(config, body.code));
      res.json({ ok: true, status: services.bot.getStatus() });
    })
  );

  app.post(
    "/api/bot/stop",
    requireAuth(services.env.JWT_SECRET),
    requireRole("admin"),
    asyncHandler(async (_req, res) => {
      await services.bot.stop();
      res.json({ ok: true, status: services.bot.getStatus() });
    })
  );

  app.post(
    "/api/system/shutdown",
    requireAuth(services.env.JWT_SECRET),
    requireRole("admin"),
    asyncHandler(async (_req, res) => {
      res.json({ ok: true });
      setTimeout(() => {
        void services.shutdown();
      }, 80);
    })
  );

  app.get(
    "/api/runtime/snapshot",
    requireAuth(services.env.JWT_SECRET),
    asyncHandler(async (_req, res) => {
      res.json({ snapshot: buildSnapshot(services) });
    })
  );

  app.get(
    "/api/logs",
    requireAuth(services.env.JWT_SECRET),
    asyncHandler(async (req, res) => {
      const query = z
        .object({
          level: z.enum(["debug", "info", "warn", "error"]).optional(),
          search: z.string().optional(),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(200).default(50),
        })
        .parse(req.query);

      const { items, total } = services.logBuffer.query({
        filter: { level: query.level, search: query.search },
        page: query.page,
        pageSize: query.pageSize,
      });

      res.json({ items, total, page: query.page, pageSize: query.pageSize });
    })
  );

  app.get(
    "/api/logs/export",
    requireAuth(services.env.JWT_SECRET),
    requireRole("admin"),
    asyncHandler(async (_req, res) => {
      res.download(services.logBuffer.getExportPath(), "logs.ndjson");
    })
  );

  app.get(
    "/api/logs/:id",
    requireAuth(services.env.JWT_SECRET),
    asyncHandler(async (req, res) => {
      const id = z.string().parse(req.params.id);
      const entry = services.logBuffer.getById(id);
      if (!entry) throw httpError(404, "NOT_FOUND");
      res.json({ entry });
    })
  );

  const webDistDir = process.env.WEB_DIST_DIR?.trim()
    ? path.resolve(process.env.WEB_DIST_DIR.trim())
    : path.join(services.projectRoot, "apps", "admin-web", "dist");
  const webIndexPath = path.join(webDistDir, "index.html");
  if (fs.existsSync(webIndexPath)) {
    app.use(express.static(webDistDir));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/")) return next();
      res.sendFile(webIndexPath);
    });
  }

  app.use((_req, _res, next) => next(httpError(404, "NOT_FOUND")));
  app.use(errorMiddleware());

  return app;
}

export function buildSnapshot(services: Services): CoreSnapshot {
  const mem = process.memoryUsage();
  const config = services.getRuntimeConfig();
  const bot = services.bot.getStatus();
  const snapshot: CoreSnapshot = {
    ts: new Date().toISOString(),
    config,
    stats: {
      uptimeSec: Math.floor(process.uptime()),
      memoryRss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      wsClients: services.getWsClientCount(),
    },
    counters: services.statsStore.get(),
    bot: {
      running: bot.running,
      connected: bot.connected,
      platform: bot.platform,
      startedAt: bot.startedAt,
      user: bot.user,
      farmSummary: bot.farmSummary ?? null,
    },
  };
  return snapshot;
}

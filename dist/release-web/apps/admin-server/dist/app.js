import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import axios from "axios";
import { asyncHandler } from "./http/asyncHandler.js";
import { errorMiddleware } from "./http/errorMiddleware.js";
import { httpError } from "./http/httpErrors.js";
import { requireAuth, requireRole } from "./auth/authMiddleware.js";
import { signAccessToken } from "./auth/jwt.js";
import { toPublicUser } from "./auth/types.js";
import { BotController } from "./bot/botController.js";
export function createApp(services) {
    const app = express();
    app.use(cors({
        origin: true,
        credentials: false,
    }));
    app.use(express.json({ limit: "1mb" }));
    let seedListCache = null;
    /**
     * 从 gameConfig/Plant.json 构建“种子清单”对照表，并按文件 mtime 做缓存刷新。
     */
    function getSeedList() {
        const filePath = path.join(services.projectRoot, "gameConfig", "Plant.json");
        const stat = fs.statSync(filePath);
        const cached = seedListCache;
        if (cached && cached.mtimeMs === stat.mtimeMs)
            return cached;
        const raw = fs.readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed))
            throw httpError(500, "PLANT_CONFIG_INVALID");
        /**
         * 解析 grow_phases 字符串：例如 "种子:2400;发芽:2400;...;成熟:0;"
         */
        function parseGrowPhases(input) {
            if (typeof input !== "string" || !input.trim())
                return [];
            return input
                .split(";")
                .map((x) => x.trim())
                .filter(Boolean)
                .map((pair) => {
                const idx = pair.indexOf(":");
                if (idx <= 0)
                    return null;
                const name = pair.slice(0, idx).trim();
                const sec = Number(pair.slice(idx + 1));
                if (!name)
                    return null;
                if (!Number.isFinite(sec) || sec < 0)
                    return null;
                return { name, sec: Math.floor(sec) };
            })
                .filter((x) => Boolean(x));
        }
        const items = parsed
            .map((row) => {
            const plantId = Number(row.id);
            const seedId = Number(row.seed_id);
            const name = typeof row.name === "string" ? row.name : "";
            const landLevelNeed = Number(row.land_level_need);
            const seasons = Number(row.seasons);
            const exp = Number(row.exp);
            const fruit = row.fruit;
            const fruitId = fruit && fruit.id != null ? Number(fruit.id) : null;
            const fruitCount = fruit && fruit.count != null ? Number(fruit.count) : null;
            const growPhases = parseGrowPhases(row.grow_phases);
            const totalGrowSec = growPhases.length > 0 ? growPhases.reduce((sum, x) => sum + (Number.isFinite(x.sec) ? x.sec : 0), 0) : null;
            if (!Number.isFinite(plantId) || plantId <= 0)
                return null;
            if (!Number.isFinite(seedId) || seedId <= 0)
                return null;
            if (!name)
                return null;
            return {
                plantId,
                seedId,
                name,
                landLevelNeed: Number.isFinite(landLevelNeed) ? landLevelNeed : 0,
                seasons: Number.isFinite(seasons) ? seasons : 0,
                exp: Number.isFinite(exp) ? exp : 0,
                fruitId: fruitId != null && Number.isFinite(fruitId) ? fruitId : null,
                fruitCount: fruitCount != null && Number.isFinite(fruitCount) ? fruitCount : null,
                totalGrowSec,
                growPhases,
            };
        })
            .filter((x) => Boolean(x))
            .sort((a, b) => a.seedId - b.seedId || a.plantId - b.plantId);
        seedListCache = { mtimeMs: stat.mtimeMs, updatedAtMs: Date.now(), items };
        return seedListCache;
    }
    app.get("/healthz", (_req, res) => {
        res.json({ ok: true });
    });
    app.post("/api/auth/login", asyncHandler(async (req, res) => {
        const bootstrapRequired = await services.userStore.needsBootstrap();
        if (bootstrapRequired)
            throw httpError(409, "BOOTSTRAP_REQUIRED");
        const body = z
            .object({
            username: z.string().min(1),
            password: z.string().min(1),
        })
            .parse(req.body);
        const user = await services.userStore.authenticate(body.username, body.password);
        if (!user)
            throw httpError(401, "INVALID_CREDENTIALS");
        const publicUser = toPublicUser(user);
        const token = signAccessToken(services.env.JWT_SECRET, publicUser);
        res.json({ token, user: publicUser });
    }));
    app.get("/api/auth/bootstrap", asyncHandler(async (_req, res) => {
        const required = await services.userStore.needsBootstrap();
        res.json({ required });
    }));
    app.post("/api/auth/bootstrap", asyncHandler(async (req, res) => {
        const required = await services.userStore.needsBootstrap();
        if (!required)
            throw httpError(409, "ALREADY_BOOTSTRAPPED");
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
    }));
    app.get("/api/auth/me", requireAuth(services.env.JWT_SECRET), asyncHandler(async (req, res) => {
        res.json({ user: req.auth });
    }));
    app.get("/api/users", requireAuth(services.env.JWT_SECRET), requireRole("admin"), asyncHandler(async (_req, res) => {
        const users = await services.userStore.listUsers();
        res.json({ users: users.map(toPublicUser) });
    }));
    app.get("/api/config", requireAuth(services.env.JWT_SECRET), asyncHandler(async (_req, res) => {
        const config = await services.configStore.get();
        res.json({ config });
    }));
    app.put("/api/config", requireAuth(services.env.JWT_SECRET), requireRole("admin"), asyncHandler(async (req, res) => {
        const config = await services.configStore.set(req.body);
        res.json({ config });
    }));
    app.get("/api/seeds", requireAuth(services.env.JWT_SECRET), asyncHandler(async (req, res) => {
        const query = z
            .object({
            q: z.string().optional(),
            page: z.coerce.number().int().min(1).optional(),
            pageSize: z.coerce.number().int().min(1).max(50000).optional(),
            sortKey: z
                .enum(["name", "seedId", "plantId", "landLevelNeed", "seasons", "exp", "fruitId", "totalGrowSec"])
                .optional(),
            sortDir: z.enum(["asc", "desc"]).optional(),
        })
            .parse(req.query);
        /**
         * 按指定字段对列表排序（支持升降序）。
         */
        function sortItems(list, sortKey, sortDir) {
            if (!sortKey)
                return list;
            const dir = sortDir === "desc" ? -1 : 1;
            const copy = list.slice();
            copy.sort((a, b) => {
                if (sortKey === "name")
                    return dir * a.name.localeCompare(b.name, "zh-Hans-CN");
                if (sortKey === "seedId")
                    return dir * (a.seedId - b.seedId);
                if (sortKey === "plantId")
                    return dir * (a.plantId - b.plantId);
                if (sortKey === "landLevelNeed")
                    return dir * (a.landLevelNeed - b.landLevelNeed);
                if (sortKey === "seasons")
                    return dir * (a.seasons - b.seasons);
                if (sortKey === "exp")
                    return dir * (a.exp - b.exp);
                if (sortKey === "fruitId") {
                    const av = a.fruitId ?? (sortDir === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
                    const bv = b.fruitId ?? (sortDir === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
                    return dir * (av - bv);
                }
                if (sortKey === "totalGrowSec") {
                    const av = a.totalGrowSec ?? (sortDir === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
                    const bv = b.totalGrowSec ?? (sortDir === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
                    return dir * (av - bv);
                }
                return 0;
            });
            return copy;
        }
        const cache = getSeedList();
        const needle = (query.q ?? "").trim();
        const numNeedle = needle && /^\d+$/.test(needle) ? Number(needle) : null;
        const filtered = needle
            ? cache.items.filter((x) => {
                if (numNeedle != null && Number.isFinite(numNeedle)) {
                    if (x.seedId === numNeedle)
                        return true;
                    if (x.plantId === numNeedle)
                        return true;
                    if (x.fruitId === numNeedle)
                        return true;
                }
                return x.name.includes(needle);
            })
            : cache.items;
        const sorted = sortItems(filtered, query.sortKey, query.sortDir ?? "asc");
        const total = sorted.length;
        const page = query.page ?? 1;
        const pageSize = query.pageSize;
        const items = pageSize ? sorted.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize) : sorted;
        res.json({ items, total, page, pageSize: pageSize ?? items.length, updatedAtMs: cache.updatedAtMs });
    }));
    app.get("/api/seeds/lookup", requireAuth(services.env.JWT_SECRET), asyncHandler(async (req, res) => {
        const query = z
            .object({
            seedId: z.coerce.number().int().min(1),
        })
            .parse(req.query);
        const cache = getSeedList();
        const hit = cache.items.find((x) => x.seedId === query.seedId) ??
            cache.items.find((x) => x.plantId === query.seedId) ??
            cache.items.find((x) => x.fruitId === query.seedId) ??
            null;
        if (!hit)
            throw httpError(404, "NOT_FOUND");
        res.json({
            seed: { seedId: hit.seedId, plantId: hit.plantId, name: hit.name, updatedAtMs: cache.updatedAtMs },
        });
    }));
    async function qrlibPost(pathName, body) {
        const base = process.env.QRLIB_BASE_URL?.trim() ? process.env.QRLIB_BASE_URL.trim() : "http://127.0.0.1:5656";
        const url = new URL(pathName, base).toString();
        try {
            const resp = await axios.post(url, body ?? {}, {
                timeout: 10_000,
                headers: { "content-type": "application/json" },
                validateStatus: () => true,
            });
            const payload = resp.data;
            if (resp.status < 200 || resp.status >= 300) {
                throw httpError(424, "QRLIB_UPSTREAM_ERROR", typeof payload === "string" ? payload : undefined);
            }
            return payload;
        }
        catch (err) {
            if (err && typeof err === "object" && "status" in err && typeof err.status === "number")
                throw err;
            throw httpError(424, "QRLIB_UNAVAILABLE", `扫码服务不可用，请确认 QRLib 已启动且 QRLIB_BASE_URL 可访问（当前：${base}）`);
        }
    }
    app.post("/api/qrlib/qr/create", requireAuth(services.env.JWT_SECRET), requireRole("admin"), asyncHandler(async (req, res) => {
        const body = z
            .object({
            preset: z.string().min(1).default("farm"),
        })
            .passthrough()
            .parse(req.body);
        const payload = await qrlibPost("/api/qr/create", body);
        res.json(payload);
    }));
    app.post("/api/qrlib/qr/check", requireAuth(services.env.JWT_SECRET), requireRole("admin"), asyncHandler(async (req, res) => {
        const body = z
            .object({
            qrsig: z.string().min(1),
        })
            .passthrough()
            .parse(req.body);
        const payload = await qrlibPost("/api/qr/check", body);
        res.json(payload);
    }));
    app.get("/api/bot/status", requireAuth(services.env.JWT_SECRET), asyncHandler(async (_req, res) => {
        res.json({ status: services.bot.getStatus() });
    }));
    app.post("/api/bot/start", requireAuth(services.env.JWT_SECRET), requireRole("admin"), asyncHandler(async (req, res) => {
        const body = z.object({ code: z.string().min(5) }).parse(req.body);
        const didReset = await services.statsStore.resetIfCodeChanged(body.code);
        if (didReset) {
            await services.logBuffer.append({ level: "info", scope: "系统", message: "检测到 code 变更，统计已重置" });
        }
        const config = await services.configStore.get();
        await services.bot.start(BotController.toStartInput(config, body.code));
        res.json({ ok: true, status: services.bot.getStatus() });
    }));
    app.post("/api/bot/stop", requireAuth(services.env.JWT_SECRET), requireRole("admin"), asyncHandler(async (_req, res) => {
        await services.bot.stop();
        res.json({ ok: true, status: services.bot.getStatus() });
    }));
    app.post("/api/system/shutdown", requireAuth(services.env.JWT_SECRET), requireRole("admin"), asyncHandler(async (_req, res) => {
        res.json({ ok: true });
        setTimeout(() => {
            void services.shutdown();
        }, 80);
    }));
    app.get("/api/runtime/snapshot", requireAuth(services.env.JWT_SECRET), asyncHandler(async (_req, res) => {
        res.json({ snapshot: buildSnapshot(services) });
    }));
    app.get("/api/logs", requireAuth(services.env.JWT_SECRET), asyncHandler(async (req, res) => {
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
    }));
    app.get("/api/logs/export", requireAuth(services.env.JWT_SECRET), requireRole("admin"), asyncHandler(async (_req, res) => {
        res.download(services.logBuffer.getExportPath(), "logs.ndjson");
    }));
    app.get("/api/logs/:id", requireAuth(services.env.JWT_SECRET), asyncHandler(async (req, res) => {
        const id = z.string().parse(req.params.id);
        const entry = services.logBuffer.getById(id);
        if (!entry)
            throw httpError(404, "NOT_FOUND");
        res.json({ entry });
    }));
    const webDistDir = process.env.WEB_DIST_DIR?.trim()
        ? path.resolve(process.env.WEB_DIST_DIR.trim())
        : path.join(services.projectRoot, "apps", "admin-web", "dist");
    const webIndexPath = path.join(webDistDir, "index.html");
    if (fs.existsSync(webIndexPath)) {
        app.use(express.static(webDistDir));
        app.get("*", (req, res, next) => {
            if (req.path.startsWith("/api/"))
                return next();
            res.sendFile(webIndexPath);
        });
    }
    app.use((_req, _res, next) => next(httpError(404, "NOT_FOUND")));
    app.use(errorMiddleware());
    return app;
}
export function buildSnapshot(services) {
    const mem = process.memoryUsage();
    const config = services.getRuntimeConfig();
    const bot = services.bot.getStatus();
    const snapshot = {
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
            lands: bot.lands ?? null,
        },
    };
    return snapshot;
}

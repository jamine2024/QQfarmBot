import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { describe, expect, it, beforeEach } from "vitest";
import { getEnv, type Env } from "../src/env";
import { UserStore } from "../src/auth/userStore";
import { LogBuffer } from "../src/logging/logBuffer";
import { ConfigStore } from "../src/runtime/configStore";
import { StatsStore } from "../src/runtime/statsStore";
import { createApp, type Services } from "../src/app";
import type { RuntimeConfig } from "../src/runtime/runtimeState";

function makeEnv(dataDir: string): Env {
  return getEnv({
    PORT: "8787",
    HOST: "127.0.0.1",
    JWT_SECRET: "dev-secret-change-me-now",
    DATA_DIR: dataDir,
    BOOTSTRAP_ADMIN_USERNAME: "admin",
    BOOTSTRAP_ADMIN_PASSWORD: "admin12345",
  });
}

describe("admin-server api", () => {
  let services: Services;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "farm-admin-"));
    const env = makeEnv(tmp);
    const userStore = new UserStore(env.DATA_DIR);

    const logBuffer = new LogBuffer({ dataDir: env.DATA_DIR });
    const configStore = new ConfigStore(env.DATA_DIR);
    const config = await configStore.get();
    const statsStore = new StatsStore({ dataDir: env.DATA_DIR, logBuffer });
    await statsStore.load();

    const bot = {
      getStatus: () => ({ running: false, connected: false, platform: "qq" as const }),
      start: async () => {},
      stop: async () => {},
      constructor: {
        toStartInput: (_cfg: RuntimeConfig, _code: string) => {
          void _cfg;
          void _code;
          return {};
        },
      },
    } as unknown as Services["bot"];

    services = {
      env,
      projectRoot: process.cwd(),
      userStore,
      logBuffer,
      configStore,
      statsStore,
      bot,
      getWsClientCount: () => 0,
      getRuntimeConfig: () => config,
      shutdown: async () => {},
    };
    app = createApp(services);
  });

  it("bootstrap then login ok and returns token", async () => {
    const status = await request(app).get("/api/auth/bootstrap");
    expect(status.status).toBe(200);
    expect(status.body.required).toBe(true);

    const boot = await request(app).post("/api/auth/bootstrap").send({ username: "admin", password: "admin12345" });
    expect(boot.status).toBe(200);
    expect(boot.body.token).toBeTypeOf("string");

    const res = await request(app).post("/api/auth/login").send({ username: "admin", password: "admin12345" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTypeOf("string");
  });

  it("config endpoints require auth", async () => {
    const res = await request(app).get("/api/config");
    expect(res.status).toBe(401);
  });

  it("read config after login", async () => {
    await request(app).post("/api/auth/bootstrap").send({ username: "admin", password: "admin12345" });
    const login = await request(app).post("/api/auth/login").send({ username: "admin", password: "admin12345" });
    const token = login.body.token as string;
    const res = await request(app).get("/api/config").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.config.platform).toBeDefined();
  });
});

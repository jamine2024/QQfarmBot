import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { getEnv } from "./env.js";
import { UserStore } from "./auth/userStore.js";
import { LogBuffer } from "./logging/logBuffer.js";
import { ConfigStore } from "./runtime/configStore.js";
import { createApp, buildSnapshot } from "./app.js";
import { WsHub } from "./ws/wsHub.js";
import { BotController } from "./bot/botController.js";
import { StatsStore } from "./runtime/statsStore.js";
function getProjectRoot() {
    const cwd = process.cwd();
    const candidates = [
        cwd,
        path.resolve(cwd, ".."),
        path.resolve(cwd, "..", ".."),
        (() => {
            const here = path.dirname(fileURLToPath(import.meta.url));
            return path.resolve(here, "..", "..", "..");
        })(),
    ];
    for (const root of candidates) {
        if (fs.existsSync(path.join(root, "apps")))
            return root;
    }
    return candidates[0] ?? cwd;
}
/**
 * 启动 HTTP + WebSocket 服务。
 */
export async function startAdminServer(input) {
    const env = input?.env ?? getEnv();
    const projectRoot = input?.projectRoot ?? getProjectRoot();
    const dataDir = path.isAbsolute(env.DATA_DIR) ? env.DATA_DIR : path.resolve(projectRoot, env.DATA_DIR);
    const logBuffer = new LogBuffer({ dataDir });
    await logBuffer.append({ level: "info", scope: "SERVER", message: "Admin server booting..." });
    const userStore = new UserStore(dataDir);
    const configStore = new ConfigStore(dataDir);
    let configCache = await configStore.get();
    const statsStore = new StatsStore({ dataDir, logBuffer });
    await statsStore.load();
    const bot = new BotController({ projectRoot, logBuffer, configStore });
    const wsHub = new WsHub({ jwtSecret: env.JWT_SECRET, logBuffer });
    const services = {
        env,
        projectRoot,
        userStore,
        logBuffer,
        configStore,
        statsStore,
        bot,
        getWsClientCount: () => wsHub.getClientCount(),
        getRuntimeConfig: () => configCache,
        shutdown: async () => { },
    };
    const app = createApp(services);
    const server = http.createServer(app);
    wsHub.attach(server, "/ws");
    const stopLogBroadcast = wsHub.startLogBroadcast();
    const stopSnapshotBroadcast = wsHub.startSnapshotBroadcast(() => buildSnapshot(services), 1500);
    let shuttingDown = false;
    const shutdown = async () => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        stopLogBroadcast();
        stopSnapshotBroadcast();
        wsHub.close();
        await bot.stop();
        await new Promise((resolve) => server.close(() => resolve()));
        process.exit(0);
    };
    services.shutdown = shutdown;
    await new Promise((resolve) => {
        server.listen(env.PORT, env.HOST, () => resolve());
    });
    const addr = server.address();
    const port = typeof addr === "object" && addr && "port" in addr && typeof addr.port === "number" ? addr.port : env.PORT;
    const host = env.HOST;
    const clientHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
    const url = `http://${clientHost}:${port}`;
    await logBuffer.append({
        level: "info",
        scope: "SERVER",
        message: `Listening on ${url}`,
        details: { ws: `ws://${clientHost}:${port}/ws` },
    });
    process.on("SIGINT", async () => {
        await shutdown();
    });
    configStore.onAfterSet = (saved) => {
        configCache = saved;
    };
    return { shutdown, url, host, port };
}
if (process.env.ADMIN_SERVER_NO_AUTORUN !== "1") {
    startAdminServer().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

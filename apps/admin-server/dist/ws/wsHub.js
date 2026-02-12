import { WebSocketServer, WebSocket } from "ws";
import { verifyAccessToken } from "../auth/jwt.js";
export class WsHub {
    jwtSecret;
    logBuffer;
    clients = new Set();
    wss;
    stopBroadcastTimer = null;
    constructor(opts) {
        this.jwtSecret = opts.jwtSecret;
        this.logBuffer = opts.logBuffer;
        this.wss = new WebSocketServer({ noServer: true });
    }
    attach(server, pathname = "/ws") {
        server.on("upgrade", (req, socket, head) => {
            try {
                const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
                if (url.pathname !== pathname)
                    return;
                const token = url.searchParams.get("token") ?? "";
                const claims = verifyAccessToken(this.jwtSecret, token);
                this.wss.handleUpgrade(req, socket, head, (ws) => {
                    this.wss.emit("connection", ws, req, claims);
                });
            }
            catch {
                socket.destroy();
            }
        });
        this.wss.on("connection", (ws, _req, claims) => {
            const user = claims;
            const client = { ws, user };
            this.clients.add(client);
            ws.on("close", () => {
                this.clients.delete(client);
            });
            ws.on("message", (raw) => {
                try {
                    const msg = JSON.parse(raw.toString("utf-8"));
                    if (msg.type === "ping") {
                        ws.send(JSON.stringify({ type: "pong" }));
                    }
                }
                catch {
                    return;
                }
            });
            const recent = this.logBuffer.tail(200);
            ws.send(JSON.stringify({ type: "log:init", data: recent }));
        });
    }
    getClientCount() {
        return this.clients.size;
    }
    startLogBroadcast() {
        const off = this.logBuffer.onAppend((entry) => {
            this.broadcast({ type: "log:append", data: entry });
        });
        return () => off();
    }
    startSnapshotBroadcast(getSnapshot, intervalMs = 1500) {
        const timer = setInterval(() => {
            const snapshot = getSnapshot();
            this.broadcast({ type: "snapshot", data: snapshot });
        }, intervalMs);
        this.stopBroadcastTimer = () => clearInterval(timer);
        return () => clearInterval(timer);
    }
    close() {
        this.stopBroadcastTimer?.();
        this.stopBroadcastTimer = null;
        for (const c of this.clients) {
            try {
                c.ws.close();
            }
            catch {
                return;
            }
        }
        this.clients.clear();
        try {
            this.wss.close();
        }
        catch {
            return;
        }
    }
    broadcast(payload) {
        const data = JSON.stringify(payload);
        for (const client of this.clients) {
            if (client.ws.readyState !== WebSocket.OPEN)
                continue;
            try {
                client.ws.send(data);
            }
            catch {
                return;
            }
        }
    }
}

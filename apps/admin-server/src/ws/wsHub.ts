import type http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { verifyAccessToken } from "../auth/jwt.js";
import type { LogBuffer } from "../logging/logBuffer.js";
import type { LogEntry } from "../logging/logTypes.js";
import type { CoreSnapshot } from "../runtime/runtimeState.js";

type WsClient = {
  ws: WebSocket;
  user: { sub: string; username: string; role: string };
};

type IncomingMessage = { type: string };

export class WsHub {
  private readonly jwtSecret: string;
  private readonly logBuffer: LogBuffer;
  private readonly clients = new Set<WsClient>();
  private readonly wss: WebSocketServer;
  private stopBroadcastTimer: (() => void) | null = null;

  constructor(opts: { jwtSecret: string; logBuffer: LogBuffer }) {
    this.jwtSecret = opts.jwtSecret;
    this.logBuffer = opts.logBuffer;
    this.wss = new WebSocketServer({ noServer: true });
  }

  attach(server: http.Server, pathname: string = "/ws"): void {
    server.on("upgrade", (req, socket, head) => {
      try {
        const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
        if (url.pathname !== pathname) return;
        const token = url.searchParams.get("token") ?? "";
        const claims = verifyAccessToken(this.jwtSecret, token);
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.wss.emit("connection", ws, req, claims);
        });
      } catch {
        socket.destroy();
      }
    });

    this.wss.on("connection", (ws: WebSocket, _req: unknown, claims: unknown) => {
      const user = claims as WsClient["user"];
      const client: WsClient = { ws, user };
      this.clients.add(client);

      ws.on("close", () => {
        this.clients.delete(client);
      });

      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString("utf-8")) as IncomingMessage;
          if (msg.type === "ping") {
            ws.send(JSON.stringify({ type: "pong" }));
          }
        } catch {
          return;
        }
      });

      const recent = this.logBuffer.tail(200);
      ws.send(JSON.stringify({ type: "log:init", data: recent }));
    });
  }

  getClientCount(): number {
    return this.clients.size;
  }

  startLogBroadcast(): () => void {
    const off = this.logBuffer.onAppend((entry: LogEntry) => {
      this.broadcast({ type: "log:append", data: entry });
    });
    return () => off();
  }

  startSnapshotBroadcast(getSnapshot: () => CoreSnapshot, intervalMs: number = 1500): () => void {
    const timer = setInterval(() => {
      const snapshot = getSnapshot();
      this.broadcast({ type: "snapshot", data: snapshot });
    }, intervalMs);
    this.stopBroadcastTimer = () => clearInterval(timer);
    return () => clearInterval(timer);
  }

  close(): void {
    this.stopBroadcastTimer?.();
    this.stopBroadcastTimer = null;
    for (const c of this.clients) {
      try {
        c.ws.close();
      } catch {
        return;
      }
    }
    this.clients.clear();
    try {
      this.wss.close();
    } catch {
      return;
    }
  }

  private broadcast(payload: unknown): void {
    const data = JSON.stringify(payload);
    for (const client of this.clients) {
      if (client.ws.readyState !== WebSocket.OPEN) continue;
      try {
        client.ws.send(data);
      } catch {
        return;
      }
    }
  }
}

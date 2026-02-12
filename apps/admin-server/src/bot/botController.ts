import path from "node:path";
import { createRequire } from "node:module";
import type { LogBuffer } from "../logging/logBuffer";
import type { RuntimeConfig } from "../runtime/runtimeState";
import type { ConfigStore } from "../runtime/configStore";
import nodemailer from "nodemailer";

type BotStatus = {
  running: boolean;
  connected: boolean;
  platform: "qq" | "wx";
  startedAt?: string;
  lastError?: string;
  user?: {
    gid: number;
    name: string;
    level: number;
    gold: number;
    exp: number;
  };
  farmSummary?: Record<string, unknown> | null;
};

type StartBotInput = {
  code: string;
  platform: "qq" | "wx";
  selfIntervalSecMin: number;
  selfIntervalSecMax: number;
  friendIntervalSecMin: number;
  friendIntervalSecMax: number;
};

type BotEvents = {
  on: (evt: "log", fn: (payload: { level: string; tag: string; message: string }) => void) => void;
  off: (evt: "log", fn: (payload: { level: string; tag: string; message: string }) => void) => void;
};

type NetworkUserState = { gid: number; name: string; level: number; gold: number; exp: number };

type FarmSummary = Record<string, unknown>;

export class BotController {
  private readonly require: NodeRequire;
  private readonly logBuffer: LogBuffer;
  private readonly configStore: ConfigStore;
  private status: BotStatus = {
    running: false,
    connected: false,
    platform: "qq",
    farmSummary: null,
  };

  private unsubscribeBotLog: (() => void) | null = null;
  private onWsClosed: (() => void) | null = null;
  private userPollTimer: NodeJS.Timeout | null = null;
  private fatalWs400Triggered = false;

  constructor(opts: { projectRoot: string; logBuffer: LogBuffer; configStore: ConfigStore }) {
    this.require = createRequire(import.meta.url);
    this.logBuffer = opts.logBuffer;
    this.configStore = opts.configStore;
    this.projectRoot = opts.projectRoot;
  }

  private readonly projectRoot: string;

  getStatus(): BotStatus {
    return { ...this.status };
  }

  async start(input: StartBotInput): Promise<void> {
    await this.stop();
    this.fatalWs400Triggered = false;

    const configMod = this.require(path.join(this.projectRoot, "src", "config.js")) as {
      CONFIG: Record<string, unknown>;
    };
    const networkMod = this.require(path.join(this.projectRoot, "src", "network.js")) as {
      connect: (code: string, onLoginSuccess: () => void) => void;
      cleanup: () => void;
      getWs: () => { close: () => void; readyState?: number } | null;
      getUserState: () => { gid: number; name: string; level: number; gold: number; exp: number };
    };
    const protoMod = this.require(path.join(this.projectRoot, "src", "proto.js")) as {
      loadProto: () => Promise<void>;
    };
    const farmMod = this.require(path.join(this.projectRoot, "src", "farm.js")) as {
      startFarmCheckLoop: () => void;
      stopFarmCheckLoop: () => void;
      getLastFarmSummary: () => unknown;
    };
    const friendMod = this.require(path.join(this.projectRoot, "src", "friend.js")) as {
      startFriendCheckLoop: () => void;
      stopFriendCheckLoop: () => void;
    };
    const taskMod = this.require(path.join(this.projectRoot, "src", "task.js")) as {
      initTaskSystem: () => void;
      cleanupTaskSystem: () => void;
    };
    const warehouseMod = this.require(path.join(this.projectRoot, "src", "warehouse.js")) as {
      startSellLoop: (ms: number) => void;
      stopSellLoop: () => void;
      debugSellFruits: () => void;
    };
    const statusMod = this.require(path.join(this.projectRoot, "src", "status.js")) as {
      cleanupStatusBar: () => void;
      initStatusBar: () => boolean;
      setStatusPlatform: (p: "qq" | "wx") => void;
    };
    const utilsMod = this.require(path.join(this.projectRoot, "src", "utils.js")) as {
      botEvents: BotEvents;
      emitRuntimeHint: (force?: boolean) => void;
    };

    const CONFIG = configMod.CONFIG as Record<string, unknown>;
    CONFIG.platform = input.platform;
    const selfMinMs = Math.max(1, input.selfIntervalSecMin) * 1000;
    const selfMaxMs = Math.max(1, input.selfIntervalSecMax) * 1000;
    const friendMinMs = Math.max(1, input.friendIntervalSecMin) * 1000;
    const friendMaxMs = Math.max(1, input.friendIntervalSecMax) * 1000;
    CONFIG.farmCheckInterval = selfMinMs;
    CONFIG.farmCheckIntervalMin = Math.min(selfMinMs, selfMaxMs);
    CONFIG.farmCheckIntervalMax = Math.max(selfMinMs, selfMaxMs);
    CONFIG.friendCheckInterval = friendMinMs;
    CONFIG.friendCheckIntervalMin = Math.min(friendMinMs, friendMaxMs);
    CONFIG.friendCheckIntervalMax = Math.max(friendMinMs, friendMaxMs);

    await protoMod.loadProto();

    this.status = {
      running: true,
      connected: false,
      platform: input.platform,
      startedAt: new Date().toISOString(),
      farmSummary: null,
    };

    const onBotLog = async (payload: { level: string; tag: string; message: string }) => {
      const level = payload.level === "warn" ? "warn" : payload.level === "error" ? "error" : "info";
      await this.logBuffer.append({ level, scope: payload.tag, message: payload.message });
      if (!this.status.running) return;
      if (payload.message.includes("Unexpected server response: 400")) {
        void this.handleFatalWs400(payload.message);
      }
    };
    utilsMod.botEvents.on("log", onBotLog);
    this.unsubscribeBotLog = () => utilsMod.botEvents.off("log", onBotLog);

    statusMod.initStatusBar();
    statusMod.setStatusPlatform(input.platform);
    utilsMod.emitRuntimeHint(true);

    networkMod.connect(input.code, async () => {
      this.status.connected = true;
      const user = networkMod.getUserState();
      this.status.user = { ...(user as NetworkUserState) };
      await this.logBuffer.append({
        level: "info",
        scope: "BOT",
        message: `登录成功: ${user.name || "unknown"} (gid=${user.gid})`,
      });

      farmMod.startFarmCheckLoop();
      friendMod.startFriendCheckLoop();
      taskMod.initTaskSystem();
      setTimeout(() => warehouseMod.debugSellFruits(), 3000);
      warehouseMod.startSellLoop(60_000);

      let lastGold = Number((user as NetworkUserState).gold ?? 0);
      let lastExp = Number((user as NetworkUserState).exp ?? 0);
      const poll = async () => {
        const next = networkMod.getUserState() as NetworkUserState;
        this.status.user = { ...next };
        const gold = Number(next.gold ?? 0);
        const exp = Number(next.exp ?? 0);
        const goldDelta = gold - lastGold;
        const expDelta = exp - lastExp;
        lastGold = gold;
        lastExp = exp;
        const parts: string[] = [];
        if (Number.isFinite(goldDelta) && goldDelta > 0) parts.push(`金币+${goldDelta}`);
        if (Number.isFinite(expDelta) && expDelta > 0) parts.push(`经验+${expDelta}`);
        if (!parts.length) return;
        await this.logBuffer.append({ level: "info", scope: "收益", message: parts.join("/") });
      };
      if (this.userPollTimer) clearInterval(this.userPollTimer);
      this.userPollTimer = setInterval(() => {
        void poll();
      }, 1200);

      this.onWsClosed = () => {
        const farmSummary = farmMod.getLastFarmSummary();
        this.status.farmSummary = (farmSummary && typeof farmSummary === "object" ? (farmSummary as FarmSummary) : null);
      };
      this.onWsClosed();
    });

    const ws = networkMod.getWs();
    if (ws) {
      const originalClose = ws.close.bind(ws);
      ws.close = () => {
        try {
          this.onWsClosed?.();
        } finally {
          originalClose();
        }
      };
    }

    this.stopFn = async () => {
      try {
        warehouseMod.stopSellLoop();
        taskMod.cleanupTaskSystem();
        friendMod.stopFriendCheckLoop();
        farmMod.stopFarmCheckLoop();
        statusMod.cleanupStatusBar();
        networkMod.cleanup();
        networkMod.getWs()?.close();
      } catch {
        return;
      }
    };
  }

  private stopFn: (() => Promise<void>) | null = null;

  async stop(): Promise<void> {
    if (!this.status.running) return;
    this.status.running = false;
    this.status.connected = false;
    this.unsubscribeBotLog?.();
    this.unsubscribeBotLog = null;
    if (this.userPollTimer) clearInterval(this.userPollTimer);
    this.userPollTimer = null;
    await this.stopFn?.();
    this.stopFn = null;
  }

  static toStartInput(config: RuntimeConfig, code: string): StartBotInput {
    return {
      code,
      platform: config.platform,
      selfIntervalSecMin: config.selfIntervalSecMin,
      selfIntervalSecMax: config.selfIntervalSecMax,
      friendIntervalSecMin: config.friendIntervalSecMin,
      friendIntervalSecMax: config.friendIntervalSecMax,
    };
  }

  private async handleFatalWs400(msg: string): Promise<void> {
    if (this.fatalWs400Triggered) return;
    this.fatalWs400Triggered = true;
    this.status.lastError = msg;
    await this.logBuffer.append({
      level: "error",
      scope: "系统",
      message: "检测到 WS 400 错误，已立即停止 bot 并尝试发送邮件通知",
    });
    await this.stop();
    await this.sendSmtpAlert("Bot 已停止：WS 400", `检测到错误：${msg}\n已停止 bot。请检查 code/网络环境后重新启动。`);
  }

  private async sendSmtpAlert(subject: string, text: string): Promise<void> {
    try {
      const config = await this.configStore.getSecret();
      const smtp = config.smtp;
      if (!smtp?.enabled) return;
      if (!smtp.host || !smtp.port || !smtp.from || !smtp.to) return;
      if (!smtp.user || !smtp.pass) {
        await this.logBuffer.append({ level: "warn", scope: "SMTP", message: "SMTP 未配置账号或密码，已跳过邮件通知" });
        return;
      }

      const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: { user: smtp.user, pass: smtp.pass },
      });

      await transporter.sendMail({
        from: smtp.from,
        to: smtp.to,
        subject,
        text,
      });

      await this.logBuffer.append({ level: "info", scope: "SMTP", message: "邮件通知已发送" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "发送失败";
      await this.logBuffer.append({ level: "warn", scope: "SMTP", message: `邮件通知失败: ${msg}` });
    }
  }
}

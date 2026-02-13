import path from "node:path";
import { createRequire } from "node:module";
import nodemailer from "nodemailer";
export class BotController {
    require;
    logBuffer;
    configStore;
    status = {
        running: false,
        connected: false,
        platform: "qq",
        farmSummary: null,
        lands: null,
    };
    unsubscribeBotLog = null;
    onWsClosed = null;
    userPollTimer = null;
    fatalWs400Triggered = false;
    levelExpStarts = null;
    lifecycle = Promise.resolve();
    constructor(opts) {
        this.require = createRequire(import.meta.url);
        this.logBuffer = opts.logBuffer;
        this.configStore = opts.configStore;
        this.projectRoot = opts.projectRoot;
    }
    projectRoot;
    getStatus() {
        return { ...this.status };
    }
    /**
     * 运行中动态更新 bot 的执行配置（不要求重启）。
     */
    applyRuntimeConfig(config) {
        const automation = config.automation ?? {
            autoHarvest: true,
            autoFertilize: true,
            autoWater: true,
            autoWeed: true,
            autoBug: true,
            autoPlant: true,
            autoTask: true,
            autoSell: true,
        };
        const farming = config.farming ?? { forceLowestLevelCrop: false };
        try {
            const configMod = this.require(path.join(this.projectRoot, "src", "config.js"));
            const botConfig = configMod.CONFIG;
            botConfig.autoHarvest = automation.autoHarvest;
            botConfig.autoFertilize = automation.autoFertilize;
            botConfig.autoWater = automation.autoWater;
            botConfig.autoWeed = automation.autoWeed;
            botConfig.autoBug = automation.autoBug;
            botConfig.autoPlant = automation.autoPlant;
            botConfig.autoTask = automation.autoTask;
            botConfig.autoSell = automation.autoSell;
            botConfig.forceLowestLevelCrop = farming.forceLowestLevelCrop;
            botConfig.fixedSeedId = typeof farming.fixedSeedId === "number" ? farming.fixedSeedId : undefined;
            void this.logBuffer
                .append({
                level: "info",
                scope: "CONFIG",
                message: "已下发运行时配置",
                details: {
                    automation,
                    farming: { forceLowestLevelCrop: farming.forceLowestLevelCrop, fixedSeedId: farming.fixedSeedId ?? null },
                },
            })
                .catch(() => { });
        }
        catch (e) {
            void this.logBuffer
                .append({
                level: "warn",
                scope: "CONFIG",
                message: "下发运行时配置失败",
                details: { error: e instanceof Error ? e.message : String(e) },
            })
                .catch(() => { });
            return;
        }
    }
    /**
     * 串行化 start/stop 等生命周期操作，避免并发导致重复监听或状态错乱
     */
    runExclusive(fn) {
        const next = this.lifecycle.then(fn, fn);
        this.lifecycle = next.catch(() => { });
        return next;
    }
    getLevelExpStarts() {
        if (this.levelExpStarts)
            return this.levelExpStarts;
        try {
            const list = this.require(path.join(this.projectRoot, "gameConfig", "RoleLevel.json"));
            if (!Array.isArray(list) || !list.length)
                return null;
            const maxLevel = list.reduce((m, x) => (typeof x?.level === "number" ? Math.max(m, x.level) : m), 0);
            if (!Number.isFinite(maxLevel) || maxLevel <= 0)
                return null;
            const starts = new Array(maxLevel + 2).fill(NaN);
            for (const item of list) {
                if (!item || typeof item.level !== "number" || typeof item.exp !== "number")
                    continue;
                starts[item.level] = item.exp;
            }
            const hasAtLeastTwo = Number.isFinite(starts[1]) && Number.isFinite(starts[2]);
            if (!hasAtLeastTwo)
                return null;
            this.levelExpStarts = starts;
            return starts;
        }
        catch {
            return null;
        }
    }
    computeExpProgress(level, totalExp) {
        const starts = this.getLevelExpStarts();
        if (!starts)
            return null;
        const exp = Number(totalExp);
        if (!Number.isFinite(exp) || exp < 0)
            return null;
        const maxLevel = starts.length - 2;
        let lvl = Number(level);
        if (!Number.isFinite(lvl) || lvl < 1)
            lvl = 1;
        lvl = Math.min(Math.floor(lvl), maxLevel);
        const startAt = starts[lvl];
        const nextAt = starts[lvl + 1];
        const lvlLooksValid = Number.isFinite(startAt) && Number.isFinite(nextAt) && exp >= startAt && exp < nextAt;
        let effective = lvl;
        if (!lvlLooksValid) {
            let lo = 1;
            let hi = maxLevel;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                const midAt = starts[mid];
                if (!Number.isFinite(midAt)) {
                    hi = mid - 1;
                    continue;
                }
                if (exp >= midAt)
                    lo = mid + 1;
                else
                    hi = mid - 1;
            }
            effective = Math.max(1, Math.min(hi, maxLevel));
        }
        const curStart = starts[effective];
        const nxtStart = starts[effective + 1];
        if (!Number.isFinite(curStart) || !Number.isFinite(nxtStart))
            return null;
        const needed = nxtStart - curStart;
        const current = exp - curStart;
        if (!Number.isFinite(needed) || !Number.isFinite(current) || needed <= 0)
            return null;
        return { current: Math.max(0, Math.min(needed, current)), needed };
    }
    /**
     * 从 bot 运行时模块中提取并刷新“农场汇总/土地列表”数据，供 WebUI 实时展示。
     */
    updateFarmViews(deps) {
        const summary = deps.farmMod.getLastFarmSummary();
        this.status.farmSummary = summary && typeof summary === "object" ? summary : null;
        const landsReply = deps.farmMod.getLastAllLandsReply?.();
        this.status.lands = this.buildLandsView(landsReply, deps);
    }
    /**
     * 将 AllLandsReply（protobuf 解码对象）转换为 WebUI 更易渲染的扁平结构。
     */
    buildLandsView(landsReply, deps) {
        const lands = landsReply?.lands;
        if (!Array.isArray(lands) || !lands.length)
            return null;
        const toTimeSec = deps.utilsMod.toTimeSec ?? ((v) => (typeof v === "number" ? v : 0));
        const nowSec = deps.utilsMod.getServerTimeSec?.() ?? Math.floor(Date.now() / 1000);
        const PHASE_NAMES = ["未知", "种子", "发芽", "小叶", "大叶", "开花", "成熟", "枯死"];
        const items = lands
            .map((raw) => {
            const land = raw;
            const idNum = Number(land?.id ?? 0);
            const unlocked = Boolean(land?.unlocked);
            const plant = land?.plant;
            const hasPhases = Array.isArray(plant?.phases) && plant.phases.length > 0;
            if (!unlocked) {
                return {
                    id: idNum,
                    unlocked,
                    cropName: null,
                    phase: null,
                    phaseName: null,
                    timeLeftSec: null,
                    needWater: false,
                    needWeed: false,
                    needBug: false,
                };
            }
            if (!plant || !hasPhases) {
                return {
                    id: idNum,
                    unlocked,
                    cropName: null,
                    phase: null,
                    phaseName: null,
                    timeLeftSec: null,
                    needWater: false,
                    needWeed: false,
                    needBug: false,
                };
            }
            const label = plant.name ? `土地#${idNum}(${plant.name})` : `土地#${idNum}`;
            const currentPhase = deps.farmMod.getCurrentPhase?.(plant.phases, false, label);
            const phaseVal = typeof currentPhase?.phase === "number" ? currentPhase.phase : null;
            const phaseName = phaseVal != null ? PHASE_NAMES[phaseVal] ?? `阶段${phaseVal}` : null;
            const mature = plant.phases.find((p) => Number(p?.phase) === 6);
            const matureAt = mature ? toTimeSec(mature.begin_time) : 0;
            const timeLeftSec = matureAt > 0 ? Math.max(0, matureAt - nowSec) : null;
            const dryNum = Number(plant.dry_num ?? 0);
            const dryTime = currentPhase ? toTimeSec(currentPhase.dry_time) : 0;
            const weedsTime = currentPhase ? toTimeSec(currentPhase.weeds_time) : 0;
            const insectTime = currentPhase ? toTimeSec(currentPhase.insect_time) : 0;
            const needWater = dryNum > 0 || (dryTime > 0 && dryTime <= nowSec);
            const needWeed = (Array.isArray(plant.weed_owners) && plant.weed_owners.length > 0) || (weedsTime > 0 && weedsTime <= nowSec);
            const needBug = (Array.isArray(plant.insect_owners) && plant.insect_owners.length > 0) || (insectTime > 0 && insectTime <= nowSec);
            return {
                id: idNum,
                unlocked,
                cropName: (plant.name && String(plant.name).trim()) || null,
                phase: phaseVal,
                phaseName,
                timeLeftSec,
                needWater,
                needWeed,
                needBug,
            };
        })
            .filter((x) => Number.isFinite(x.id))
            .sort((a, b) => a.id - b.id);
        const unlockedCount = items.filter((x) => x.unlocked).length;
        return { updatedAt: Date.now(), total: items.length, unlocked: unlockedCount, items };
    }
    async start(input) {
        await this.runExclusive(async () => {
            await this.startInternal(input);
        });
    }
    async startInternal(input) {
        await this.stopInternal();
        this.fatalWs400Triggered = false;
        const configMod = this.require(path.join(this.projectRoot, "src", "config.js"));
        const networkMod = this.require(path.join(this.projectRoot, "src", "network.js"));
        const protoMod = this.require(path.join(this.projectRoot, "src", "proto.js"));
        const farmMod = this.require(path.join(this.projectRoot, "src", "farm.js"));
        const friendMod = this.require(path.join(this.projectRoot, "src", "friend.js"));
        const taskMod = this.require(path.join(this.projectRoot, "src", "task.js"));
        const warehouseMod = this.require(path.join(this.projectRoot, "src", "warehouse.js"));
        const statusMod = this.require(path.join(this.projectRoot, "src", "status.js"));
        const utilsMod = this.require(path.join(this.projectRoot, "src", "utils.js"));
        const CONFIG = configMod.CONFIG;
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
        try {
            const runtime = await this.configStore.get();
            this.applyRuntimeConfig(runtime);
        }
        catch {
            // ignore
        }
        await protoMod.loadProto();
        this.status = {
            running: true,
            connected: false,
            platform: input.platform,
            startedAt: new Date().toISOString(),
            farmSummary: null,
        };
        utilsMod.botEvents.removeAllListeners?.("log");
        const onBotLog = async (payload) => {
            const level = payload.level === "warn" ? "warn" : payload.level === "error" ? "error" : "info";
            await this.logBuffer.append({ level, scope: payload.tag, message: payload.message });
            if (!this.status.running)
                return;
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
            const expProgress = this.computeExpProgress(user.level, user.exp);
            this.status.user = {
                ...user,
                expProgress: expProgress ?? undefined,
            };
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
            let lastGold = Number(user.gold ?? 0);
            let lastExp = Number(user.exp ?? 0);
            const poll = async () => {
                const next = networkMod.getUserState();
                const expProgress = this.computeExpProgress(next.level, next.exp);
                this.status.user = {
                    ...next,
                    expProgress: expProgress ?? undefined,
                };
                this.updateFarmViews({ farmMod, utilsMod });
                const gold = Number(next.gold ?? 0);
                const exp = Number(next.exp ?? 0);
                const goldDelta = gold - lastGold;
                const expDelta = exp - lastExp;
                lastGold = gold;
                lastExp = exp;
                const parts = [];
                if (Number.isFinite(goldDelta) && goldDelta > 0)
                    parts.push(`金币+${goldDelta}`);
                if (Number.isFinite(expDelta) && expDelta > 0)
                    parts.push(`经验+${expDelta}`);
                if (!parts.length)
                    return;
                await this.logBuffer.append({ level: "info", scope: "收益", message: parts.join("/") });
            };
            if (this.userPollTimer)
                clearInterval(this.userPollTimer);
            this.userPollTimer = setInterval(() => {
                void poll();
            }, 1200);
            this.onWsClosed = () => {
                this.updateFarmViews({ farmMod, utilsMod });
            };
            this.onWsClosed();
        });
        const ws = networkMod.getWs();
        if (ws) {
            const originalClose = ws.close.bind(ws);
            ws.close = () => {
                try {
                    this.onWsClosed?.();
                }
                finally {
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
            }
            catch {
                return;
            }
        };
    }
    stopFn = null;
    async stop() {
        await this.runExclusive(async () => {
            await this.stopInternal();
        });
    }
    async stopInternal() {
        this.status.running = false;
        this.status.connected = false;
        this.unsubscribeBotLog?.();
        this.unsubscribeBotLog = null;
        if (this.userPollTimer)
            clearInterval(this.userPollTimer);
        this.userPollTimer = null;
        await this.stopFn?.();
        this.stopFn = null;
    }
    static toStartInput(config, code) {
        return {
            code,
            platform: config.platform,
            selfIntervalSecMin: config.selfIntervalSecMin,
            selfIntervalSecMax: config.selfIntervalSecMax,
            friendIntervalSecMin: config.friendIntervalSecMin,
            friendIntervalSecMax: config.friendIntervalSecMax,
        };
    }
    async handleFatalWs400(msg) {
        if (this.fatalWs400Triggered)
            return;
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
    async sendSmtpAlert(subject, text) {
        try {
            const config = await this.configStore.getSecret();
            const smtp = config.smtp;
            if (!smtp?.enabled)
                return;
            if (!smtp.host || !smtp.port || !smtp.from || !smtp.to)
                return;
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
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : "发送失败";
            await this.logBuffer.append({ level: "warn", scope: "SMTP", message: `邮件通知失败: ${msg}` });
        }
    }
}

import path from "node:path";
import fs from "node:fs";
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
    expProgress?: { current: number; needed: number };
  };
  farmSummary?: Record<string, unknown> | null;
  lands?: {
    updatedAt: number;
    total: number;
    unlocked: number;
    items: Array<{
      id: number;
      unlocked: boolean;
      cropName: string | null;
      phase: number | null;
      phaseName: string | null;
      timeLeftSec: number | null;
      progress: number | null;
      needWater: boolean;
      needWeed: boolean;
      needBug: boolean;
    }>;
  } | null;
  bag?: {
    updatedAt: number;
    items: Array<{
      id: number;
      kind: "gold" | "seed" | "fruit" | "item";
      name: string;
      count: number;
      unitPriceGold: number | null;
    }>;
  } | null;
  visits?: {
    updatedAt: number;
    items: Array<{
      id: string;
      ts: string;
      direction: "incoming" | "outgoing";
      gid: number;
      name: string | null;
      kind: "visit" | "steal" | "weed" | "bug" | "water";
      message: string;
    }>;
  } | null;
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
  on(evt: "log", fn: (payload: { level: string; tag: string; message: string }) => void): void;
  on(
    evt: "visit",
    fn: (payload: {
      direction: "incoming" | "outgoing";
      gid: number;
      name: string | null;
      ts: string;
      kind: "visit" | "steal" | "weed" | "bug" | "water";
      message: string;
    }) => void
  ): void;
  off(evt: "log", fn: (payload: { level: string; tag: string; message: string }) => void): void;
  off(
    evt: "visit",
    fn: (payload: {
      direction: "incoming" | "outgoing";
      gid: number;
      name: string | null;
      ts: string;
      kind: "visit" | "steal" | "weed" | "bug" | "water";
      message: string;
    }) => void
  ): void;
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
    lands: null,
    bag: null,
    visits: null,
  };

  private unsubscribeBotLog: (() => void) | null = null;
  private onWsClosed: (() => void) | null = null;
  private userPollTimer: NodeJS.Timeout | null = null;
  private fatalWs400Triggered = false;
  private patrolDisconnectTriggered = false;
  private kickoutTriggered = false;
  private levelExpStarts: number[] | null = null;
  private lifecycle = Promise.resolve();
  private friendControl: { start: () => void; stop: () => void } | null = null;
  private friendFarmEnabled = true;
  private bagPollInFlight = false;
  private bagLastPollAtMs = 0;
  private bagIndex:
    | {
        seedPriceBySeedId: Map<number, number>;
        seedNameBySeedId: Map<number, string>;
        fruitByFruitId: Map<number, { name: string; fruitCount: number | null; seedId: number | null }>;
        goodsNameById: Map<number, string>;
      }
    | null = null;
  private bagIndexMeta: { plantMtimeMs: number; shopMtimeMs: number; goodsMtimeMs: number } | null = null;
  private unsubscribeBotVisit: (() => void) | null = null;

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

  /**
   * 追加一条到访记录（对外暴露给 WebUI 展示）。
   */
  private appendVisitRecord(input: {
    ts: string;
    direction: "incoming" | "outgoing";
    gid: number;
    name: string | null;
    kind: "visit" | "steal" | "weed" | "bug" | "water";
    message: string;
  }): void {
    const list = (this.status.visits?.items ?? []).slice();
    list.push({ id: `${input.ts}-${input.direction}-${input.gid}-${input.kind}`, ...input });
    const keep = list.length > 400 ? list.slice(list.length - 400) : list;
    this.status.visits = { updatedAt: Date.now(), items: keep };
  }

  /**
   * 构建背包定价/作物映射索引（Plant.json + 种子商店导出数据）。
   */
  private getBagIndex(): NonNullable<BotController["bagIndex"]> {
    const plantPath = path.join(this.projectRoot, "gameConfig", "Plant.json");
    const shopPath = path.join(this.projectRoot, "tools", "seed-shop-merged-export.json");
    const goodsPath = path.join(this.projectRoot, "gameConfig", "goods.txt");
    let plantMtimeMs = 0;
    let shopMtimeMs = 0;
    let goodsMtimeMs = 0;
    try {
      plantMtimeMs = fs.statSync(plantPath).mtimeMs;
    } catch {
      plantMtimeMs = 0;
    }
    try {
      shopMtimeMs = fs.statSync(shopPath).mtimeMs;
    } catch {
      shopMtimeMs = 0;
    }
    try {
      goodsMtimeMs = fs.statSync(goodsPath).mtimeMs;
    } catch {
      goodsMtimeMs = 0;
    }
    if (
      this.bagIndex &&
      this.bagIndexMeta &&
      this.bagIndexMeta.plantMtimeMs === plantMtimeMs &&
      this.bagIndexMeta.shopMtimeMs === shopMtimeMs &&
      this.bagIndexMeta.goodsMtimeMs === goodsMtimeMs
    ) {
      return this.bagIndex;
    }
    const req = this.require as NodeRequire & {
      cache?: Record<string, unknown>;
      resolve?: (id: string) => string;
    };
    const clearModuleCache = (modulePath: string): void => {
      try {
        const resolved = req.resolve ? req.resolve(modulePath) : modulePath;
        if (req.cache && req.cache[resolved]) delete req.cache[resolved];
      } catch {
        return;
      }
    };
    clearModuleCache(plantPath);
    clearModuleCache(shopPath);
    const seedPriceBySeedId = new Map<number, number>();
    const seedNameBySeedId = new Map<number, string>();
    const fruitByFruitId = new Map<number, { name: string; fruitCount: number | null; seedId: number | null }>();
    const goodsNameById = new Map<number, string>();

    try {
      const plantList = this.require(plantPath) as Array<{
        id: number;
        name: string;
        seed_id?: number;
        fruit?: { id?: number; count?: number };
      }>;
      for (const p of plantList) {
        const seedId = typeof p?.seed_id === "number" ? p.seed_id : null;
        if (seedId != null && typeof p?.name === "string" && p.name) seedNameBySeedId.set(seedId, p.name);
        const fruitId = typeof p?.fruit?.id === "number" ? p.fruit.id : null;
        if (fruitId != null) {
          fruitByFruitId.set(fruitId, {
            name: typeof p?.name === "string" && p.name ? p.name : `果实${fruitId}`,
            fruitCount: typeof p?.fruit?.count === "number" ? p.fruit.count : null,
            seedId,
          });
        }
      }
    } catch {
      // ignore
    }

    try {
      const exported = this.require(shopPath) as {
        rows?: Array<{ seedId: number; name?: string; price?: number; fruitId?: number; fruitCount?: number }>;
      };
      for (const r of exported?.rows ?? []) {
        const seedId = typeof r?.seedId === "number" ? r.seedId : null;
        const price = typeof r?.price === "number" ? r.price : null;
        if (seedId != null && price != null) seedPriceBySeedId.set(seedId, price);
        if (seedId != null && typeof r?.name === "string" && r.name && !seedNameBySeedId.has(seedId)) {
          seedNameBySeedId.set(seedId, r.name);
        }
      }
    } catch {
      // ignore
    }

    try {
      let raw = fs.readFileSync(goodsPath, "utf-8");
      if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const idx = trimmed.indexOf(":");
        if (idx <= 0) continue;
        const id = Number(trimmed.slice(0, idx).trim());
        const name = trimmed.slice(idx + 1).trim();
        if (!Number.isFinite(id) || id <= 0 || !name) continue;
        goodsNameById.set(id, name);
      }
    } catch {
      // ignore
    }

    this.bagIndex = { seedPriceBySeedId, seedNameBySeedId, fruitByFruitId, goodsNameById };
    this.bagIndexMeta = { plantMtimeMs, shopMtimeMs, goodsMtimeMs };
    return this.bagIndex;
  }

  /**
   * 刷新背包展示数据（用于 WebUI 实时显示）。
   */
  private async refreshBagView(deps: {
    warehouseMod: { getBag: () => Promise<unknown>; getBagItems: (bagReply: unknown) => unknown[] };
    utilsMod: { toNum: (v: unknown) => number };
  }): Promise<void> {
    if (!this.status.running || !this.status.connected) return;
    if (this.bagPollInFlight) return;
    this.bagPollInFlight = true;
    try {
      const index = this.getBagIndex();
      const bagReply = await deps.warehouseMod.getBag();
      const rawItems = deps.warehouseMod.getBagItems(bagReply);
      const items = rawItems
        .map((it) => {
          const id = deps.utilsMod.toNum((it as { id?: unknown }).id);
          const count = deps.utilsMod.toNum((it as { count?: unknown }).count);
          if (!Number.isFinite(id) || id <= 0) return null;
          if (!Number.isFinite(count) || count <= 0) return null;

          if (id === 1001) {
            return { id, kind: "gold" as const, name: "金币", count, unitPriceGold: null };
          }

          const seedPrice = index.seedPriceBySeedId.get(id);
          if (seedPrice != null) {
            const name = index.seedNameBySeedId.get(id) ?? `种子${id}`;
            return { id, kind: "seed" as const, name, count, unitPriceGold: seedPrice };
          }

          const fruitMeta = index.fruitByFruitId.get(id);
          if (fruitMeta) {
            const seedId = fruitMeta.seedId;
            const seedUnit = seedId != null ? index.seedPriceBySeedId.get(seedId) : null;
            const unit =
              seedUnit != null && fruitMeta.fruitCount != null && fruitMeta.fruitCount > 0
                ? Math.round((seedUnit / fruitMeta.fruitCount) * 10000) / 10000
                : null;
            return { id, kind: "fruit" as const, name: fruitMeta.name, count, unitPriceGold: unit };
          }

          const goodsName = index.goodsNameById.get(id);
          return { id, kind: "item" as const, name: goodsName ?? `物品${id}`, count, unitPriceGold: null };
        })
        .filter(Boolean) as NonNullable<BotStatus["bag"]>["items"];

      const kindRank: Record<NonNullable<BotStatus["bag"]>["items"][number]["kind"], number> = {
        gold: 0,
        seed: 1,
        fruit: 2,
        item: 3,
      };
      items.sort((a, b) => kindRank[a.kind] - kindRank[b.kind] || a.id - b.id);
      this.status.bag = { updatedAt: Date.now(), items };
    } catch {
      return;
    } finally {
      this.bagPollInFlight = false;
    }
  }

  /**
   * 运行中动态更新 bot 的执行配置（不要求重启）。
   */
  applyRuntimeConfig(config: RuntimeConfig): void {
    const automation = config.automation ?? {
      autoHarvest: true,
      autoFertilize: true,
      autoWater: true,
      autoWeed: true,
      autoBug: true,
      autoPlant: true,
      autoFriendFarm: true,
      autoTask: true,
      autoSell: true,
    };
    const farming = config.farming ?? { forceLowestLevelCrop: false, forceLatestLevelCrop: false };
    try {
      const configMod = this.require(path.join(this.projectRoot, "src", "config.js")) as unknown as {
        CONFIG: Record<string, unknown>;
      };
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
      botConfig.forceLatestLevelCrop = Boolean(farming.forceLatestLevelCrop);
      botConfig.disableAutoRecommend = Boolean(farming.disableAutoRecommend);
      botConfig.fixedSeedId = typeof farming.fixedSeedId === "number" ? farming.fixedSeedId : undefined;
      const wantFriendFarm = Boolean(automation.autoFriendFarm);
      if (this.status.running && this.friendControl && wantFriendFarm !== this.friendFarmEnabled) {
        if (wantFriendFarm) this.friendControl.start();
        else this.friendControl.stop();
        this.friendFarmEnabled = wantFriendFarm;
        void this.logBuffer
          .append({
            level: "info",
            scope: "CONFIG",
            message: wantFriendFarm ? "已开启好友农场巡查" : "已关闭好友农场巡查",
          })
          .catch(() => {});
      }
      void this.logBuffer
        .append({
          level: "info",
          scope: "CONFIG",
          message: "已下发运行时配置",
          details: {
            automation,
            farming: {
              forceLowestLevelCrop: farming.forceLowestLevelCrop,
              forceLatestLevelCrop: Boolean(farming.forceLatestLevelCrop),
              disableAutoRecommend: Boolean(farming.disableAutoRecommend),
              fixedSeedId: farming.fixedSeedId ?? null,
            },
          },
        })
        .catch(() => {});
    } catch (e: unknown) {
      void this.logBuffer
        .append({
          level: "warn",
          scope: "CONFIG",
          message: "下发运行时配置失败",
          details: { error: e instanceof Error ? e.message : String(e) },
        })
        .catch(() => {});
      return;
    }
  }

  /**
   * 串行化 start/stop 等生命周期操作，避免并发导致重复监听或状态错乱
   */
  private runExclusive(fn: () => Promise<void>): Promise<void> {
    const next = this.lifecycle.then(fn, fn);
    this.lifecycle = next.catch(() => {});
    return next;
  }

  private getLevelExpStarts(): number[] | null {
    if (this.levelExpStarts) return this.levelExpStarts;
    try {
      const list = this.require(path.join(this.projectRoot, "gameConfig", "RoleLevel.json")) as Array<{
        level: number;
        exp: number;
      }>;
      if (!Array.isArray(list) || !list.length) return null;
      const maxLevel = list.reduce((m, x) => (typeof x?.level === "number" ? Math.max(m, x.level) : m), 0);
      if (!Number.isFinite(maxLevel) || maxLevel <= 0) return null;
      const starts: number[] = new Array(maxLevel + 2).fill(NaN);
      for (const item of list) {
        if (!item || typeof item.level !== "number" || typeof item.exp !== "number") continue;
        starts[item.level] = item.exp;
      }
      const hasAtLeastTwo = Number.isFinite(starts[1]) && Number.isFinite(starts[2]);
      if (!hasAtLeastTwo) return null;
      this.levelExpStarts = starts;
      return starts;
    } catch {
      return null;
    }
  }

  private computeExpProgress(level: number, totalExp: number): { current: number; needed: number } | null {
    const starts = this.getLevelExpStarts();
    if (!starts) return null;
    const exp = Number(totalExp);
    if (!Number.isFinite(exp) || exp < 0) return null;

    const maxLevel = starts.length - 2;
    let lvl = Number(level);
    if (!Number.isFinite(lvl) || lvl < 1) lvl = 1;
    lvl = Math.min(Math.floor(lvl), maxLevel);

    const startAt = starts[lvl];
    const nextAt = starts[lvl + 1];
    const lvlLooksValid =
      Number.isFinite(startAt) && Number.isFinite(nextAt) && exp >= (startAt as number) && exp < (nextAt as number);

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
        if (exp >= (midAt as number)) lo = mid + 1;
        else hi = mid - 1;
      }
      effective = Math.max(1, Math.min(hi, maxLevel));
    }

    const curStart = starts[effective];
    const nxtStart = starts[effective + 1];
    if (!Number.isFinite(curStart) || !Number.isFinite(nxtStart)) return null;
    const needed = (nxtStart as number) - (curStart as number);
    const current = exp - (curStart as number);
    if (!Number.isFinite(needed) || !Number.isFinite(current) || needed <= 0) return null;
    return { current: Math.max(0, Math.min(needed, current)), needed };
  }

  /**
   * 从 bot 运行时模块中提取并刷新“农场汇总/土地列表”数据，供 WebUI 实时展示。
   */
  private updateFarmViews(deps: {
    farmMod: {
      getLastFarmSummary: () => unknown;
      getLastAllLandsReply?: () => unknown;
      getCurrentPhase?: (phases: unknown, debug?: boolean, landLabel?: string) => unknown;
    };
    utilsMod: { getServerTimeSec?: () => number; toTimeSec?: (v: unknown) => number };
  }): void {
    const summary = deps.farmMod.getLastFarmSummary();
    this.status.farmSummary = summary && typeof summary === "object" ? (summary as FarmSummary) : null;
    const landsReply = deps.farmMod.getLastAllLandsReply?.();
    this.status.lands = this.buildLandsView(landsReply, deps);
  }

  /**
   * 将 AllLandsReply（protobuf 解码对象）转换为 WebUI 更易渲染的扁平结构。
   */
  private buildLandsView(
    landsReply: unknown,
    deps: {
      farmMod: { getCurrentPhase?: (phases: unknown, debug?: boolean, landLabel?: string) => unknown };
      utilsMod: { getServerTimeSec?: () => number; toTimeSec?: (v: unknown) => number };
    }
  ): BotStatus["lands"] {
    const lands = (landsReply as { lands?: unknown[] } | null)?.lands;
    if (!Array.isArray(lands) || !lands.length) return null;

    const toTimeSec = deps.utilsMod.toTimeSec ?? ((v: unknown) => (typeof v === "number" ? v : 0));
    const nowSec = deps.utilsMod.getServerTimeSec?.() ?? Math.floor(Date.now() / 1000);

    const PHASE_NAMES = ["未知", "种子", "发芽", "小叶", "大叶", "开花", "成熟", "枯死"];

    const items = lands
      .map((raw) => {
        const land = raw as {
          id?: unknown;
          unlocked?: boolean;
          plant?: {
            name?: string;
            dry_num?: unknown;
            weed_owners?: unknown[];
            insect_owners?: unknown[];
            phases?: unknown[];
          } | null;
        };
        const idNum = Number(land?.id ?? 0);
        const unlocked = Boolean(land?.unlocked);

        const plant = land?.plant;
        const hasPhases = Array.isArray(plant?.phases) && plant!.phases!.length > 0;
        if (!unlocked) {
          return {
            id: idNum,
            unlocked,
            cropName: null,
            phase: null,
            phaseName: null,
            timeLeftSec: null,
            progress: null,
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
            progress: null,
            needWater: false,
            needWeed: false,
            needBug: false,
          };
        }

        const label = plant.name ? `土地#${idNum}(${plant.name})` : `土地#${idNum}`;
        const currentPhase = deps.farmMod.getCurrentPhase?.(plant.phases, false, label) as { phase?: number; dry_time?: unknown; weeds_time?: unknown; insect_time?: unknown } | null;
        const phaseVal = typeof currentPhase?.phase === "number" ? currentPhase.phase : null;
        const phaseName = phaseVal != null ? PHASE_NAMES[phaseVal] ?? `阶段${phaseVal}` : null;

        const phases = plant.phases as Array<{ phase?: unknown; begin_time?: unknown }>;
        const firstPhase = phases[0];
        const mature = phases.find((p) => Number(p?.phase) === 6);
        const firstAt = firstPhase ? toTimeSec(firstPhase.begin_time) : 0;
        const matureAt = mature ? toTimeSec(mature.begin_time) : 0;
        const timeLeftSec = matureAt > 0 ? Math.max(0, matureAt - nowSec) : null;
        
        let progress: number | null = null;
        
        if (phaseVal != null && phaseVal >= 1 && phaseVal <= 7) {
          const phaseProgressMap: Record<number, number> = {
            1: 10,
            2: 25,
            3: 40,
            4: 60,
            5: 80,
            6: 100,
            7: 0,
          };
          
          progress = phaseProgressMap[phaseVal] ?? 0;
          
          if (timeLeftSec != null && matureAt > 0 && firstAt > 0) {
            const totalGrow = matureAt - firstAt;
            if (totalGrow > 0) {
              const elapsed = totalGrow - timeLeftSec;
              if (elapsed >= 0) {
                progress = Math.min(100, Math.max(0, (elapsed / totalGrow) * 100));
              }
            }
          }
        } else {
          progress = 0;
        }

        const dryNum = Number(plant.dry_num ?? 0);
        const dryTime = currentPhase ? toTimeSec(currentPhase.dry_time) : 0;
        const weedsTime = currentPhase ? toTimeSec(currentPhase.weeds_time) : 0;
        const insectTime = currentPhase ? toTimeSec(currentPhase.insect_time) : 0;

        const needWater = dryNum > 0 || (dryTime > 0 && dryTime <= nowSec);
        const needWeed = (Array.isArray(plant.weed_owners) && plant.weed_owners.length > 0) || (weedsTime > 0 && weedsTime <= nowSec);
        const needBug =
          (Array.isArray(plant.insect_owners) && plant.insect_owners.length > 0) || (insectTime > 0 && insectTime <= nowSec);

        return {
          id: idNum,
          unlocked,
          cropName: (plant.name && String(plant.name).trim()) || null,
          phase: phaseVal,
          phaseName,
          timeLeftSec,
          progress,
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

  async start(input: StartBotInput): Promise<void> {
    await this.runExclusive(async () => {
      await this.startInternal(input);
    });
  }

  private async startInternal(input: StartBotInput): Promise<void> {
    await this.stopInternal();
    this.fatalWs400Triggered = false;
    this.patrolDisconnectTriggered = false;
    this.kickoutTriggered = false;

    const req = this.require as NodeRequire & {
      cache?: Record<string, unknown>;
      resolve?: (id: string) => string;
    };
    const clearModuleCache = (modulePath: string): void => {
      try {
        const resolved = req.resolve ? req.resolve(modulePath) : modulePath;
        if (req.cache && req.cache[resolved]) delete req.cache[resolved];
      } catch {
        return;
      }
    };
    clearModuleCache(path.join(this.projectRoot, "src", "farm.js"));
    clearModuleCache(path.join(this.projectRoot, "src", "gameConfig.js"));

    const configMod = this.require(path.join(this.projectRoot, "src", "config.js")) as {
      CONFIG: Record<string, unknown>;
    };
    const networkMod = this.require(path.join(this.projectRoot, "src", "network.js")) as {
      connect: (code: string, onLoginSuccess: () => void) => void;
      cleanup: () => void;
      getWs: () => { close: () => void; readyState?: number; on?: (evt: string, cb: (...args: unknown[]) => void) => void } | null;
      getUserState: () => { gid: number; name: string; level: number; gold: number; exp: number };
    };
    const protoMod = this.require(path.join(this.projectRoot, "src", "proto.js")) as {
      loadProto: () => Promise<void>;
    };
    const farmMod = this.require(path.join(this.projectRoot, "src", "farm.js")) as {
      startFarmCheckLoop: () => void;
      stopFarmCheckLoop: () => void;
      getCurrentPhase?: (phases: unknown, debug?: boolean, landLabel?: string) => unknown;
      getLastAllLandsReply?: () => unknown;
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
      getBag: () => Promise<unknown>;
      getBagItems: (bagReply: unknown) => unknown[];
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
      getServerTimeSec?: () => number;
      toTimeSec?: (v: unknown) => number;
      toNum: (v: unknown) => number;
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

    this.friendControl = { start: friendMod.startFriendCheckLoop, stop: friendMod.stopFriendCheckLoop };
    try {
      const runtime = await this.configStore.get();
      this.friendFarmEnabled = Boolean(runtime.automation?.autoFriendFarm ?? true);
      this.applyRuntimeConfig(runtime);
    } catch {
      // ignore
    }

    await protoMod.loadProto();

    this.status = {
      running: true,
      connected: false,
      platform: input.platform,
      startedAt: new Date().toISOString(),
      farmSummary: null,
      bag: null,
      visits: { updatedAt: Date.now(), items: [] },
    };

    (utilsMod.botEvents as unknown as { removeAllListeners?: (evt: string) => void }).removeAllListeners?.("log");
    (utilsMod.botEvents as unknown as { removeAllListeners?: (evt: string) => void }).removeAllListeners?.("visit");

    const onBotLog = async (payload: { level: string; tag: string; message: string }) => {
      const level = payload.level === "warn" ? "warn" : payload.level === "error" ? "error" : "info";
      await this.logBuffer.append({ level, scope: payload.tag, message: payload.message });
      if (!this.status.running) return;
      if (
        payload.message.includes("被踢下线") ||
        payload.message.includes("连接关闭") ||
        payload.message.includes("已在其他终端登录")
      ) {
        void this.handleKickoutOrDisconnect(payload.message);
      }
      if (payload.message.includes("Unexpected server response: 400")) {
        void this.handleFatalWs400(payload.message);
      }
      if (payload.message.includes("巡查失败") && payload.message.includes("连接未打开")) {
        void this.handlePatrolDisconnect(payload.message);
      }
    };
    utilsMod.botEvents.on("log", onBotLog);
    this.unsubscribeBotLog = () => utilsMod.botEvents.off("log", onBotLog);

    const onBotVisit = (payload: {
      direction: "incoming" | "outgoing";
      gid: number;
      name: string | null;
      ts: string;
      kind: "visit" | "steal" | "weed" | "bug" | "water";
      message: string;
    }) => {
      if (!this.status.running) return;
      this.appendVisitRecord(payload);
    };
    utilsMod.botEvents.on("visit", onBotVisit);
    this.unsubscribeBotVisit = () => utilsMod.botEvents.off("visit", onBotVisit);

    statusMod.initStatusBar();
    statusMod.setStatusPlatform(input.platform);
    utilsMod.emitRuntimeHint(true);

    networkMod.connect(input.code, async () => {
      this.status.connected = true;
      const user = networkMod.getUserState() as NetworkUserState;
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
      if (this.friendFarmEnabled) friendMod.startFriendCheckLoop();
      taskMod.initTaskSystem();
      setTimeout(() => warehouseMod.debugSellFruits(), 3000);
      warehouseMod.startSellLoop(60_000);

      let lastGold = Number((user as NetworkUserState).gold ?? 0);
      let lastExp = Number((user as NetworkUserState).exp ?? 0);
      const poll = async () => {
        const next = networkMod.getUserState() as NetworkUserState;
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
        const parts: string[] = [];
        if (Number.isFinite(goldDelta) && goldDelta > 0) parts.push(`金币+${goldDelta}`);
        if (Number.isFinite(expDelta) && expDelta > 0) parts.push(`经验+${expDelta}`);
        if (!parts.length) return;
        await this.logBuffer.append({ level: "info", scope: "收益", message: parts.join("/") });
      };
      if (this.userPollTimer) clearInterval(this.userPollTimer);
      this.userPollTimer = setInterval(() => {
        void poll();
        const now = Date.now();
        if (now - this.bagLastPollAtMs >= 8000) {
          this.bagLastPollAtMs = now;
          void this.refreshBagView({ warehouseMod, utilsMod });
        }
      }, 1200);

      this.onWsClosed = () => {
        this.updateFarmViews({ farmMod, utilsMod });
      };
      this.onWsClosed();
    });

    const ws = networkMod.getWs();
    if (ws) {
      const hint =
        input.platform === "qq"
          ? "（若你抓的是微信 code，请把平台改成 wx 再启动）"
          : "（若你抓的是 QQ code，请把平台改成 qq 再启动）";

      ws.on?.("close", (closeCode) => {
        if (!this.status.running) return;
        this.status.connected = false;
        const code = typeof closeCode === "number" ? closeCode : -1;
        this.status.lastError = `[WS] 连接关闭 (code=${code})`;
        const msg = `[WS] 连接关闭 (code=${code}) ${hint}`;
        void this.logBuffer.append({
          level: code === 1000 ? "info" : "warn",
          scope: "WS",
          message: msg,
        });
        void this.handleKickoutOrDisconnect(msg);
        try {
          this.onWsClosed?.();
        } catch {
          return;
        }
      });

      ws.on?.("error", (err) => {
        if (!this.status.running) return;
        const msg = err instanceof Error ? err.message : "unknown";
        this.status.lastError = `[WS] 错误: ${msg}`;
        void this.logBuffer.append({ level: "warn", scope: "WS", message: `[WS] 错误: ${msg}` });
      });

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
    await this.runExclusive(async () => {
      await this.stopInternal();
    });
  }

  private async stopInternal(): Promise<void> {
    this.status.running = false;
    this.status.connected = false;
    this.unsubscribeBotLog?.();
    this.unsubscribeBotLog = null;
    this.unsubscribeBotVisit?.();
    this.unsubscribeBotVisit = null;
    if (this.userPollTimer) clearInterval(this.userPollTimer);
    this.userPollTimer = null;
    await this.stopFn?.();
    this.stopFn = null;
    this.friendControl = null;
    this.status.bag = null;
  }

  static toStartInput(config: RuntimeConfig, code: string, platformOverride?: "qq" | "wx"): StartBotInput {
    return {
      code,
      platform: platformOverride ?? config.platform,
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

  /**
   * 处理巡查过程中连接未打开的异常，发送告警并停止 bot。
   */
  private async handlePatrolDisconnect(msg: string): Promise<void> {
    if (this.patrolDisconnectTriggered) return;
    this.patrolDisconnectTriggered = true;
    this.status.lastError = msg;
    await this.logBuffer.append({
      level: "error",
      scope: "系统",
      message: "巡查失败：连接未打开，可能已经掉线，已停止 bot 并尝试发送邮件通知",
    });
    await this.stop();
    await this.sendSmtpAlert(
      "Bot 已停止：连接未打开",
      `检测到巡查失败：${msg}\n系统判断连接已断开，已停止 bot。请检查网络/重新登录后再启动。`
    );
  }

  private async handleKickoutOrDisconnect(msg: string): Promise<void> {
    if (this.kickoutTriggered) return;
    this.kickoutTriggered = true;
    this.status.lastError = msg;
    await this.logBuffer.append({
      level: "error",
      scope: "系统",
      message: "检测到异常下线/连接关闭，已立即停止 bot 并尝试发送邮件通知",
    });
    await this.stop();
    await this.sendSmtpAlert(
      "Bot 已停止：异常下线",
      `检测到异常下线或连接关闭：${msg}\n已停止 bot。请确认是否在其他终端登录或网络异常。`
    );
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

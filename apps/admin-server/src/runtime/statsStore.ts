import path from "node:path";
import crypto from "node:crypto";
import type { LogEntry } from "../logging/logTypes.js";
import type { LogBuffer } from "../logging/logBuffer.js";
import { readJsonFile, writeJsonFile } from "../storage/jsonStore.js";
import type { RuntimeCounters } from "./runtimeState.js";

function defaultCounters(): RuntimeCounters {
  return {
    updatedAt: new Date().toISOString(),
    gains: {
      gold: 0,
      exp: 0,
    },
    actions: {
      water: 0,
      bug: 0,
      weed: 0,
      fertilize: 0,
      plant: 0,
      harvest: 0,
      remove: 0,
      steal: 0,
      putBug: 0,
      putWeed: 0,
    },
    crops: {},
    items: {},
  };
}

function addItem(map: Record<string, number>, name: string, delta: number): void {
  const key = name.trim();
  if (!key) return;
  map[key] = (map[key] ?? 0) + delta;
}

/**
 * 解析 “名称数量/名称数量” 格式的列表为结构化数据。
 */
function parseNameCountList(text: string): Array<{ name: string; count: number }> {
  return text
    .split("/")
    .map((s) => s.trim())
    .map((seg) => {
      const m = seg.match(/^(.+?)(\d+)$/);
      if (!m) return null;
      return { name: m[1], count: Number(m[2]) };
    })
    .filter((x): x is { name: string; count: number } => x !== null && Number.isFinite(x.count));
}

/**
 * 从日志中的 “收获/偷(作物明细)” 提取作物数量并累计。
 */
function applyFromHarvestDetail(counters: RuntimeCounters, message: string): void {
  const matches = message.matchAll(/(?:收获|偷)\d+\(([^)]*)\)/g);
  for (const m of matches) {
    const inner = m[1] ?? "";
    for (const seg of parseNameCountList(inner)) {
      addItem(counters.crops, seg.name, seg.count);
    }
  }
}

function addAction(counters: RuntimeCounters, key: keyof RuntimeCounters["actions"], delta: number): void {
  if (!Number.isFinite(delta) || delta <= 0) return;
  counters.actions[key] += delta;
}

function parseSummarySegments(text: string): Array<{ label: string; count: number }> {
  const idx = text.indexOf("→");
  if (idx < 0) return [];
  const tail = text.slice(idx + 1);

  /**
   * 按 “/” 切分操作段，但忽略括号内的 “/”（例如：收获3(白萝卜1/胡萝卜2)）。
   */
  function splitOutsideParens(input: string): string[] {
    const parts: string[] = [];
    let buf = "";
    let depth = 0;
    for (const ch of input) {
      if (ch === "(") depth += 1;
      if (ch === ")" && depth > 0) depth -= 1;
      if (ch === "/" && depth === 0) {
        parts.push(buf);
        buf = "";
        continue;
      }
      buf += ch;
    }
    parts.push(buf);
    return parts;
  }

  return splitOutsideParens(tail)
    .map((s) => s.trim())
    .map((seg) => {
      const base = seg.replace(/\([^)]*\)\s*$/, "");
      const m = base.match(/^(.+?)(\d+)$/);
      if (!m) return null;
      return { label: m[1], count: Number(m[2]) };
    })
    .filter((x): x is { label: string; count: number } => x !== null && Number.isFinite(x.count));
}

function applyFromFarmLog(counters: RuntimeCounters, message: string): void {
  for (const seg of parseSummarySegments(message)) {
    if (seg.label === "浇水") addAction(counters, "water", seg.count);
    if (seg.label === "除虫" || seg.label === "捉虫") addAction(counters, "bug", seg.count);
    if (seg.label === "除草") addAction(counters, "weed", seg.count);
    if (seg.label === "收获") addAction(counters, "harvest", seg.count);
    if (seg.label === "种植") addAction(counters, "plant", seg.count);
    if (seg.label === "铲除") addAction(counters, "remove", seg.count);
  }
}

function applyFromFriendLog(counters: RuntimeCounters, message: string): void {
  for (const seg of parseSummarySegments(message)) {
    if (seg.label === "浇水") addAction(counters, "water", seg.count);
    if (seg.label === "除虫" || seg.label === "捉虫") addAction(counters, "bug", seg.count);
    if (seg.label === "除草") addAction(counters, "weed", seg.count);
    if (seg.label === "偷") addAction(counters, "steal", seg.count);
    if (seg.label === "放虫") addAction(counters, "putBug", seg.count);
    if (seg.label === "放草") addAction(counters, "putWeed", seg.count);
  }
}

function applyFromFertilizeLog(counters: RuntimeCounters, message: string): void {
  const m = message.match(/已为\s*(\d+)\s*\/\s*(\d+)\s*块地施肥/);
  if (!m) return;
  addAction(counters, "fertilize", Number(m[1]));
}

function applyFromPurchaseLog(counters: RuntimeCounters, message: string): void {
  const m = message.match(/已购买\s+(.+?)种子\s*x\s*(\d+)/);
  if (!m) return;
  addItem(counters.items, m[1], Number(m[2]));
}

function applyFromGoldLog(counters: RuntimeCounters, message: string): void {
  const all = [...message.matchAll(/获得\s*(\d+)\s*金币/g)];
  if (!all.length) return;
  let total = 0;
  for (const m of all) total += Number(m[1] ?? 0);
  if (!Number.isFinite(total) || total <= 0) return;
  counters.gains.gold += total;
}

function applyFromGainsLog(counters: RuntimeCounters, message: string): void {
  const gold = message.match(/金币\+(\d+)/);
  const exp = message.match(/经验\+(\d+)/);
  const goldDelta = gold ? Number(gold[1]) : 0;
  const expDelta = exp ? Number(exp[1]) : 0;
  if (Number.isFinite(goldDelta) && goldDelta > 0) counters.gains.gold += goldDelta;
  if (Number.isFinite(expDelta) && expDelta > 0) counters.gains.exp += expDelta;
}

export class StatsStore {
  private readonly filePath: string;
  private readonly botSessionPath: string;
  private counters: RuntimeCounters = defaultCounters();
  private persistTimer: NodeJS.Timeout | null = null;

  constructor(opts: { dataDir: string; logBuffer: LogBuffer }) {
    this.filePath = path.join(opts.dataDir, "counters.json");
    this.botSessionPath = path.join(opts.dataDir, "botSession.json");
    opts.logBuffer.onAppend((entry) => this.onLog(entry));
  }

  async load(): Promise<void> {
    const base = defaultCounters();
    const loaded = await readJsonFile<RuntimeCounters>(this.filePath, base);
    this.counters = {
      ...base,
      ...loaded,
      gains: { ...base.gains, ...(loaded.gains ?? {}) },
      actions: { ...base.actions, ...(loaded.actions ?? {}) },
      crops: { ...(loaded.crops ?? {}) },
      items: { ...(loaded.items ?? {}) },
    };
  }

  get(): RuntimeCounters {
    return this.counters;
  }

  /**
   * 重置所有统计（并持久化）。
   */
  async resetAll(): Promise<void> {
    this.counters = defaultCounters();
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    await writeJsonFile(this.filePath, this.counters);
  }

  /**
   * 当启动 code 发生变化时重置统计：用于避免不同会话的累计混在一起。
   */
  async resetIfCodeChanged(code: string): Promise<boolean> {
    const hash = crypto.createHash("sha256").update(code, "utf8").digest("hex");
    const base = { lastCodeHash: "" };
    const state = await readJsonFile<{ lastCodeHash?: string }>(this.botSessionPath, base);
    const last = typeof state.lastCodeHash === "string" ? state.lastCodeHash : "";
    const changed = Boolean(last) && last !== hash;
    await writeJsonFile(this.botSessionPath, { lastCodeHash: hash });
    if (!changed) return false;
    await this.resetAll();
    return true;
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void writeJsonFile(this.filePath, this.counters);
    }, 600);
  }

  private touch(): void {
    this.counters.updatedAt = new Date().toISOString();
    this.schedulePersist();
  }

  private onLog(entry: LogEntry): void {
    if (entry.scope === "农场") {
      applyFromFarmLog(this.counters, entry.message);
      applyFromHarvestDetail(this.counters, entry.message);
      this.touch();
      return;
    }
    if (entry.scope === "好友") {
      applyFromFriendLog(this.counters, entry.message);
      applyFromHarvestDetail(this.counters, entry.message);
      this.touch();
      return;
    }
    if (entry.scope === "仓库") {
      applyFromGoldLog(this.counters, entry.message);
      this.touch();
      return;
    }
    if (entry.scope === "收益") {
      applyFromGainsLog(this.counters, entry.message);
      this.touch();
      return;
    }
    if (entry.scope === "施肥") {
      applyFromFertilizeLog(this.counters, entry.message);
      this.touch();
      return;
    }
    if (entry.scope === "购买") {
      applyFromPurchaseLog(this.counters, entry.message);
      this.touch();
      return;
    }
  }
}

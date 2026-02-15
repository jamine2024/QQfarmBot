import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type React from "react";

export type LogEntry = {
  id: string;
  ts: string;
  level: "debug" | "info" | "warn" | "error";
  scope: string;
  message: string;
  repeat?: number;
  details?: Record<string, unknown>;
};

export type Snapshot = {
  ts: string;
  config: {
    selfIntervalSecMin: number;
    selfIntervalSecMax: number;
    friendIntervalSecMin: number;
    friendIntervalSecMax: number;
    platform: "qq" | "wx";
    automation?: {
      autoHarvest: boolean;
      autoFertilize: boolean;
      autoWater: boolean;
      autoWeed: boolean;
      autoBug: boolean;
      autoPlant: boolean;
      autoFriendFarm: boolean;
      autoTask: boolean;
      autoSell: boolean;
    };
    farming?: {
      forceLowestLevelCrop: boolean;
      forceLatestLevelCrop?: boolean;
      fixedSeedId?: number;
    };
    ui?: {
      wallpaper?: {
        sync: boolean;
        mode: "local" | "off";
      };
    };
    smtp?: {
      enabled: boolean;
      host: string;
      port: number;
      secure: boolean;
      user: string;
      passSet: boolean;
      from: string;
      to: string;
    };
  };
  stats: { uptimeSec: number; memoryRss: number; heapUsed: number; heapTotal: number; wsClients: number };
  counters: {
    updatedAt: string;
    gains: {
      gold: number;
      exp: number;
    };
    actions: {
      water: number;
      bug: number;
      weed: number;
      fertilize: number;
      plant: number;
      harvest: number;
      remove: number;
      steal: number;
      putBug: number;
      putWeed: number;
    };
    crops: Record<string, number>;
    items: Record<string, number>;
  };
  bot?: {
    running: boolean;
    connected: boolean;
    platform: "qq" | "wx";
    startedAt?: string;
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
};

export type SnapshotHistoryPoint = { ts: string; heapUsed: number; rss: number };

type DataContextValue = {
  snapshot: Snapshot | null;
  setSnapshot: (s: Snapshot | null) => void;
  snapshotHistory: SnapshotHistoryPoint[];
  logs: LogEntry[];
  setLogs: (logs: LogEntry[]) => void;
  appendLog: (entry: LogEntry) => void;
};

const DataContext = createContext<DataContextValue | null>(null);

function parseTsMs(ts: string): number {
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : NaN;
}

function canMergeLog(prev: LogEntry, next: LogEntry): boolean {
  if (prev.level !== next.level) return false;
  if (prev.scope !== next.scope) return false;
  if (prev.message !== next.message) return false;
  const a = parseTsMs(prev.ts);
  const b = parseTsMs(next.ts);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return prev.ts === next.ts;
  return Math.abs(b - a) <= 2000;
}

function mergeLogEntry(prev: LogEntry, next: LogEntry): LogEntry {
  const repeat = (prev.repeat ?? 1) + 1;
  return { ...prev, ts: next.ts, details: next.details ?? prev.details, repeat };
}

function compactLogs(list: LogEntry[]): LogEntry[] {
  const out: LogEntry[] = [];
  for (const entry of list) {
    const last = out[out.length - 1];
    if (last && canMergeLog(last, entry)) {
      out[out.length - 1] = mergeLogEntry(last, entry);
    } else {
      out.push(entry);
    }
  }
  return out;
}

export function DataProvider(props: { children: React.ReactNode }): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [snapshotHistory, setSnapshotHistory] = useState<SnapshotHistoryPoint[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logWindow = 50;

  /**
   * 同步更新最新快照，并维护内存趋势用的历史窗口。
   */
  const setSnapshotWithHistory = useCallback((s: Snapshot | null): void => {
    setSnapshot(s);
    setSnapshotHistory((prev) => {
      if (!s) return [];
      if (prev.length && prev[prev.length - 1]?.ts === s.ts) return prev;
      const next = prev.slice();
      next.push({ ts: s.ts, heapUsed: s.stats.heapUsed, rss: s.stats.memoryRss });
      if (next.length > 60) next.shift();
      return next;
    });
  }, []);

  const setLogsWithLimit = useCallback(
    (list: LogEntry[]): void => {
      setLogs(compactLogs(list).slice(-logWindow));
    },
    [logWindow]
  );

  const value = useMemo<DataContextValue>(
    () => ({
      snapshot,
      setSnapshot: setSnapshotWithHistory,
      snapshotHistory,
      logs,
      setLogs: setLogsWithLimit,
      appendLog: (entry) =>
        setLogs((prev) => {
          const last = prev[prev.length - 1];
          if (last && canMergeLog(last, entry)) {
            const keep = prev.slice();
            keep[keep.length - 1] = mergeLogEntry(last, entry);
            return keep;
          }
          const keep = prev.length >= logWindow ? prev.slice(prev.length - (logWindow - 1)) : prev.slice();
          keep.push(entry);
          return keep;
        }),
    }),
    [logWindow, logs, setLogsWithLimit, snapshot, snapshotHistory, setSnapshotWithHistory]
  );

  return <DataContext.Provider value={value}>{props.children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("DataProvider missing");
  return ctx;
}

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type React from "react";

export type LogEntry = {
  id: string;
  ts: string;
  level: "debug" | "info" | "warn" | "error";
  scope: string;
  message: string;
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
    user?: { gid: number; name: string; level: number; gold: number; exp: number };
    farmSummary?: Record<string, unknown> | null;
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

export function DataProvider(props: { children: React.ReactNode }): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [snapshotHistory, setSnapshotHistory] = useState<SnapshotHistoryPoint[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);

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

  const value = useMemo<DataContextValue>(
    () => ({
      snapshot,
      setSnapshot: setSnapshotWithHistory,
      snapshotHistory,
      logs,
      setLogs,
      appendLog: (entry) =>
        setLogs((prev) => {
          const next = prev.length > 2000 ? prev.slice(prev.length - 1500) : prev.slice();
          next.push(entry);
          return next;
        }),
    }),
    [logs, snapshot, snapshotHistory, setSnapshotWithHistory]
  );

  return <DataContext.Provider value={value}>{props.children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("DataProvider missing");
  return ctx;
}

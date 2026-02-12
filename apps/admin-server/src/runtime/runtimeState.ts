export type RuntimeConfig = {
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

export type RuntimeStats = {
  uptimeSec: number;
  memoryRss: number;
  heapUsed: number;
  heapTotal: number;
  wsClients: number;
};

export type RuntimeCounters = {
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

export type CoreSnapshot = {
  ts: string;
  config: RuntimeConfig;
  stats: RuntimeStats;
  counters: RuntimeCounters;
  bot?: {
    running: boolean;
    connected: boolean;
    platform: "qq" | "wx";
    startedAt?: string;
    user?: { gid: number; name: string; level: number; gold: number; exp: number };
    farmSummary?: Record<string, unknown> | null;
  };
};

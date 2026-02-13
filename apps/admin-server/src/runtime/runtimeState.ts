export type RuntimeConfig = {
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

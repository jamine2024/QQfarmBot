import path from "node:path";
import { z } from "zod";
import { readJsonFile, writeJsonFile } from "../storage/jsonStore.js";
import type { RuntimeConfig } from "./runtimeState.js";

type StoredRuntimeConfig = {
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
    autoFriendFarm?: boolean;
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
      mode: "online" | "local" | "off";
    };
  };
  smtp?: {
    enabled: boolean;
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass?: string;
    from: string;
    to: string;
  };
};

const LegacyRuntimeConfigSchema = z.object({
  selfIntervalSec: z.number().int().min(1).max(3600),
  friendIntervalSec: z.number().int().min(1).max(3600),
  platform: z.enum(["qq", "wx"]),
});

const StoredRuntimeConfigSchema = z.object({
  selfIntervalSecMin: z.number().int().min(1).max(3600),
  selfIntervalSecMax: z.number().int().min(1).max(3600),
  friendIntervalSecMin: z.number().int().min(1).max(3600),
  friendIntervalSecMax: z.number().int().min(1).max(3600),
  platform: z.enum(["qq", "wx"]),
  automation: z
    .object({
      autoHarvest: z.boolean(),
      autoFertilize: z.boolean(),
      autoWater: z.boolean(),
      autoWeed: z.boolean(),
      autoBug: z.boolean(),
      autoPlant: z.boolean(),
      autoFriendFarm: z.boolean().optional(),
      autoTask: z.boolean(),
      autoSell: z.boolean(),
    })
    .optional(),
  farming: z
    .object({
      forceLowestLevelCrop: z.boolean(),
      fixedSeedId: z.number().int().min(1).max(1_000_000_000).optional(),
    })
    .optional(),
  ui: z
    .object({
      wallpaper: z
        .object({
          sync: z.boolean(),
          mode: z.enum(["online", "local", "off"]),
        })
        .optional(),
    })
    .optional(),
  smtp: z
    .object({
      enabled: z.boolean(),
      host: z.string().max(200),
      port: z.number().int().min(0).max(65535),
      secure: z.boolean(),
      user: z.string().max(200),
      pass: z.string().max(500).optional(),
      from: z.string().max(500),
      to: z.string().max(2000),
    })
    .optional(),
});

const ApiRuntimeConfigSchema = StoredRuntimeConfigSchema.extend({
  ui: z
    .object({
      wallpaper: z
        .object({
          sync: z.boolean(),
          mode: z.enum(["local", "off"]),
        })
        .optional(),
    })
    .optional(),
}).superRefine((val, ctx) => {
  if (val.selfIntervalSecMin > val.selfIntervalSecMax) {
    ctx.addIssue({ code: "custom", message: "selfIntervalSecMin must be <= selfIntervalSecMax", path: ["selfIntervalSecMin"] });
  }
  if (val.friendIntervalSecMin > val.friendIntervalSecMax) {
    ctx.addIssue({ code: "custom", message: "friendIntervalSecMin must be <= friendIntervalSecMax", path: ["friendIntervalSecMin"] });
  }
  if (val.smtp?.enabled) {
    if (!val.smtp.host.trim()) ctx.addIssue({ code: "custom", message: "smtp.host required", path: ["smtp", "host"] });
    if (!val.smtp.port) ctx.addIssue({ code: "custom", message: "smtp.port required", path: ["smtp", "port"] });
    if (!val.smtp.from.trim()) ctx.addIssue({ code: "custom", message: "smtp.from required", path: ["smtp", "from"] });
    if (!val.smtp.to.trim()) ctx.addIssue({ code: "custom", message: "smtp.to required", path: ["smtp", "to"] });
  }
});

/**
 * 运行参数存储（JSON 文件）+ 校验。
 */
export class ConfigStore {
  private readonly filePath: string;
  onAfterSet?: (saved: RuntimeConfig) => void;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "config.json");
  }

  private toStored(raw: unknown): StoredRuntimeConfig | null {
    const legacy = LegacyRuntimeConfigSchema.safeParse(raw);
    if (legacy.success) {
      return {
        platform: legacy.data.platform,
        selfIntervalSecMin: legacy.data.selfIntervalSec,
        selfIntervalSecMax: legacy.data.selfIntervalSec,
        friendIntervalSecMin: legacy.data.friendIntervalSec,
        friendIntervalSecMax: legacy.data.friendIntervalSec,
      };
    }
    const stored = StoredRuntimeConfigSchema.safeParse(raw);
    if (stored.success) return stored.data;
    return null;
  }

  private toPublic(stored: StoredRuntimeConfig): RuntimeConfig {
    const ui = {
      wallpaper: {
        sync: true,
        mode: stored.ui?.wallpaper?.mode === "off" ? ("off" as const) : ("local" as const),
      },
    };
    const storedAutomation = stored.automation ?? {
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
    const automation: NonNullable<RuntimeConfig["automation"]> = {
      ...storedAutomation,
      autoFriendFarm: storedAutomation.autoFriendFarm ?? true,
    };
    const farming = stored.farming ?? { forceLowestLevelCrop: false };
    return {
      platform: stored.platform,
      selfIntervalSecMin: stored.selfIntervalSecMin,
      selfIntervalSecMax: stored.selfIntervalSecMax,
      friendIntervalSecMin: stored.friendIntervalSecMin,
      friendIntervalSecMax: stored.friendIntervalSecMax,
      automation,
      farming,
      ui,
      smtp: stored.smtp
        ? {
            enabled: stored.smtp.enabled,
            host: stored.smtp.host,
            port: stored.smtp.port,
            secure: stored.smtp.secure,
            user: stored.smtp.user,
            passSet: Boolean(stored.smtp.pass),
            from: stored.smtp.from,
            to: stored.smtp.to,
          }
        : undefined,
    };
  }

  /**
   * 读取配置（若不存在则写入默认值并返回）。
   */
  async get(): Promise<RuntimeConfig> {
    const fallback: StoredRuntimeConfig = {
      platform: "qq",
      selfIntervalSecMin: 10,
      selfIntervalSecMax: 10,
      friendIntervalSecMin: 1,
      friendIntervalSecMax: 1,
      automation: {
        autoHarvest: true,
        autoFertilize: true,
        autoWater: true,
        autoWeed: true,
        autoBug: true,
        autoPlant: true,
        autoFriendFarm: true,
        autoTask: true,
        autoSell: true,
      },
      farming: { forceLowestLevelCrop: false },
      ui: { wallpaper: { sync: true, mode: "local" } },
    };
    const raw = await readJsonFile<unknown>(this.filePath, fallback);
    const stored = this.toStored(raw);
    if (!stored) {
      await writeJsonFile(this.filePath, fallback);
      return this.toPublic(fallback);
    }
    return this.toPublic(stored);
  }

  async getSecret(): Promise<StoredRuntimeConfig> {
    const fallback: StoredRuntimeConfig = {
      platform: "qq",
      selfIntervalSecMin: 10,
      selfIntervalSecMax: 10,
      friendIntervalSecMin: 1,
      friendIntervalSecMax: 1,
      automation: {
        autoHarvest: true,
        autoFertilize: true,
        autoWater: true,
        autoWeed: true,
        autoBug: true,
        autoPlant: true,
        autoFriendFarm: true,
        autoTask: true,
        autoSell: true,
      },
      farming: { forceLowestLevelCrop: false },
      ui: { wallpaper: { sync: true, mode: "local" } },
    };
    const raw = await readJsonFile<unknown>(this.filePath, fallback);
    const stored = this.toStored(raw);
    if (!stored) {
      await writeJsonFile(this.filePath, fallback);
      return fallback;
    }
    return stored;
  }

  /**
   * 更新配置并持久化。
   */
  async set(next: unknown): Promise<RuntimeConfig> {
    const parsed = ApiRuntimeConfigSchema.parse(next);
    const current = await this.getSecret();
    const merged: StoredRuntimeConfig = {
      platform: parsed.platform,
      selfIntervalSecMin: parsed.selfIntervalSecMin,
      selfIntervalSecMax: parsed.selfIntervalSecMax,
      friendIntervalSecMin: parsed.friendIntervalSecMin,
      friendIntervalSecMax: parsed.friendIntervalSecMax,
      automation: parsed.automation ?? current.automation,
      farming: parsed.farming
        ? {
            forceLowestLevelCrop: parsed.farming.forceLowestLevelCrop,
            fixedSeedId: parsed.farming.fixedSeedId,
          }
        : current.farming,
      ui: parsed.ui
        ? {
            wallpaper: parsed.ui.wallpaper
              ? {
                  sync: true,
                  mode: parsed.ui.wallpaper.mode,
                }
              : current.ui?.wallpaper,
          }
        : current.ui,
      smtp: parsed.smtp
        ? {
            enabled: parsed.smtp.enabled,
            host: parsed.smtp.host,
            port: parsed.smtp.port,
            secure: parsed.smtp.secure,
            user: parsed.smtp.user,
            pass:
              typeof parsed.smtp.pass === "string" && parsed.smtp.pass.trim()
                ? parsed.smtp.pass
                : current.smtp?.pass,
            from: parsed.smtp.from,
            to: parsed.smtp.to,
          }
        : current.smtp,
    };
    await writeJsonFile(this.filePath, merged);
    const pub = this.toPublic(merged);
    this.onAfterSet?.(pub);
    return pub;
  }
}

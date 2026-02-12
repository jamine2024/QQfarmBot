import path from "node:path";
import { z } from "zod";
import { readJsonFile, writeJsonFile } from "../storage/jsonStore.js";
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
const ApiRuntimeConfigSchema = StoredRuntimeConfigSchema.superRefine((val, ctx) => {
    if (val.selfIntervalSecMin > val.selfIntervalSecMax) {
        ctx.addIssue({ code: "custom", message: "selfIntervalSecMin must be <= selfIntervalSecMax", path: ["selfIntervalSecMin"] });
    }
    if (val.friendIntervalSecMin > val.friendIntervalSecMax) {
        ctx.addIssue({ code: "custom", message: "friendIntervalSecMin must be <= friendIntervalSecMax", path: ["friendIntervalSecMin"] });
    }
    if (val.smtp?.enabled) {
        if (!val.smtp.host.trim())
            ctx.addIssue({ code: "custom", message: "smtp.host required", path: ["smtp", "host"] });
        if (!val.smtp.port)
            ctx.addIssue({ code: "custom", message: "smtp.port required", path: ["smtp", "port"] });
        if (!val.smtp.from.trim())
            ctx.addIssue({ code: "custom", message: "smtp.from required", path: ["smtp", "from"] });
        if (!val.smtp.to.trim())
            ctx.addIssue({ code: "custom", message: "smtp.to required", path: ["smtp", "to"] });
    }
});
/**
 * 运行参数存储（JSON 文件）+ 校验。
 */
export class ConfigStore {
    filePath;
    onAfterSet;
    constructor(dataDir) {
        this.filePath = path.join(dataDir, "config.json");
    }
    toStored(raw) {
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
        if (stored.success)
            return stored.data;
        return null;
    }
    toPublic(stored) {
        return {
            platform: stored.platform,
            selfIntervalSecMin: stored.selfIntervalSecMin,
            selfIntervalSecMax: stored.selfIntervalSecMax,
            friendIntervalSecMin: stored.friendIntervalSecMin,
            friendIntervalSecMax: stored.friendIntervalSecMax,
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
    async get() {
        const fallback = {
            platform: "qq",
            selfIntervalSecMin: 10,
            selfIntervalSecMax: 10,
            friendIntervalSecMin: 1,
            friendIntervalSecMax: 1,
        };
        const raw = await readJsonFile(this.filePath, fallback);
        const stored = this.toStored(raw);
        if (!stored) {
            await writeJsonFile(this.filePath, fallback);
            return this.toPublic(fallback);
        }
        return this.toPublic(stored);
    }
    async getSecret() {
        const fallback = {
            platform: "qq",
            selfIntervalSecMin: 10,
            selfIntervalSecMax: 10,
            friendIntervalSecMin: 1,
            friendIntervalSecMax: 1,
        };
        const raw = await readJsonFile(this.filePath, fallback);
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
    async set(next) {
        const parsed = ApiRuntimeConfigSchema.parse(next);
        const current = await this.getSecret();
        const merged = {
            platform: parsed.platform,
            selfIntervalSecMin: parsed.selfIntervalSecMin,
            selfIntervalSecMax: parsed.selfIntervalSecMax,
            friendIntervalSecMin: parsed.friendIntervalSecMin,
            friendIntervalSecMax: parsed.friendIntervalSecMax,
            smtp: parsed.smtp
                ? {
                    enabled: parsed.smtp.enabled,
                    host: parsed.smtp.host,
                    port: parsed.smtp.port,
                    secure: parsed.smtp.secure,
                    user: parsed.smtp.user,
                    pass: typeof parsed.smtp.pass === "string" && parsed.smtp.pass.trim()
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

import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  HOST: z.string().default("0.0.0.0"),
  JWT_SECRET: z.string().min(16).default("dev-secret-change-me-now"),
  DATA_DIR: z.string().default("data/admin"),
  BOOTSTRAP_ADMIN_USERNAME: z.string().default("admin"),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(8).default("admin12345"),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * 解析并验证运行环境变量。
 */
export function getEnv(input: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(input);
}


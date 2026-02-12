import fs from "node:fs/promises";
import path from "node:path";

/**
 * 确保目录存在。
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * 读取 JSON 文件；不存在则返回 fallback。
 */
export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (e: unknown) {
    if (isNodeErrno(e) && e.code === "ENOENT") return fallback;
    throw e;
  }
}

/**
 * 原子写入 JSON 文件（先写临时文件再 rename）。
 */
export async function writeJsonFile<T>(filePath: string, value: T): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(value, null, 2), "utf-8");
  await fs.rename(tmpPath, filePath);
}

function isNodeErrno(e: unknown): e is NodeJS.ErrnoException {
  return typeof e === "object" && e !== null && "code" in e;
}


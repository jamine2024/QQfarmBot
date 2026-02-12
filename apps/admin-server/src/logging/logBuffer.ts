import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir } from "../storage/jsonStore.js";
import type { LogEntry, LogLevel } from "./logTypes.js";

export type LogFilter = {
  level?: LogLevel;
  search?: string;
};

/**
 * 日志缓冲区：同时支持内存回放 + 持久化到 NDJSON 文件（便于导出）。
 */
export class LogBuffer {
  private readonly entries: LogEntry[] = [];
  private readonly maxEntries: number;
  private readonly logFilePath: string;
  private listeners = new Set<(entry: LogEntry) => void>();

  constructor(opts: { dataDir: string; maxEntries?: number }) {
    this.maxEntries = opts.maxEntries ?? 3000;
    this.logFilePath = path.join(opts.dataDir, "logs.ndjson");
  }

  /**
   * 写入一条日志。
   */
  async append(input: Omit<LogEntry, "id" | "ts"> & { ts?: string }): Promise<LogEntry> {
    const entry: LogEntry = {
      id: crypto.randomUUID(),
      ts: input.ts ?? new Date().toISOString(),
      level: input.level,
      scope: input.scope,
      message: input.message,
      details: input.details,
    };

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) this.entries.shift();

    await ensureDir(path.dirname(this.logFilePath));
    await fs.appendFile(this.logFilePath, `${JSON.stringify(entry)}\n`, "utf-8");

    for (const fn of this.listeners) fn(entry);
    return entry;
  }

  /**
   * 订阅新增日志事件；返回取消订阅函数。
   */
  onAppend(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 根据条件查询内存日志（支持搜索 + 等级过滤 + 分页）。
   */
  query(opts: { filter?: LogFilter; page: number; pageSize: number }): {
    items: LogEntry[];
    total: number;
  } {
    const { filter, page, pageSize } = opts;
    let list = this.entries.slice();
    if (filter?.level) list = list.filter((e) => e.level === filter.level);
    if (filter?.search) {
      const q = filter.search.toLowerCase();
      list = list.filter((e) => `${e.scope} ${e.message}`.toLowerCase().includes(q));
    }
    list.reverse();
    const total = list.length;
    const start = (page - 1) * pageSize;
    const items = list.slice(start, start + pageSize);
    return { items, total };
  }

  /**
   * 获取最近 N 条日志，用于 WebSocket 首次回放。
   */
  tail(limit: number): LogEntry[] {
    const slice = this.entries.slice(-limit);
    return slice;
  }

  /**
   * 根据 ID 查找日志详情。
   */
  getById(id: string): LogEntry | null {
    return this.entries.find((e) => e.id === id) ?? null;
  }

  /**
   * 获取日志导出文件路径（NDJSON）。
   */
  getExportPath(): string {
    return this.logFilePath;
  }
}


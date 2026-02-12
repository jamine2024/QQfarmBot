export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEntry = {
  id: string;
  ts: string;
  level: LogLevel;
  scope: string;
  message: string;
  details?: Record<string, unknown>;
};


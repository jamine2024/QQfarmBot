export type ApiError = {
  status: number;
  code: string;
  message?: string;
};

const API_BASE = "";

function getApiErrorInfo(payload: unknown): { code?: string; message?: string } {
  if (!payload || typeof payload !== "object") return {};
  const obj = payload as Record<string, unknown>;
  const code = typeof obj.error === "string" ? obj.error : undefined;
  const message = typeof obj.message === "string" ? obj.message : undefined;
  return { code, message };
}

export async function apiFetch<T>(
  input: string,
  opts: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    token?: string | null;
    body?: unknown;
    signal?: AbortSignal;
  } = {}
): Promise<T> {
  const res = await fetch(`${API_BASE}${input}`, {
    method: opts.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });

  const contentType = res.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const payload: unknown = isJson ? await res.json() : null;

  if (!res.ok) {
    const info = getApiErrorInfo(payload);
    const err: ApiError = {
      status: res.status,
      code: info.code ?? "HTTP_ERROR",
      message: info.message,
    };
    throw err;
  }
  return (payload ?? (await res.text())) as T;
}

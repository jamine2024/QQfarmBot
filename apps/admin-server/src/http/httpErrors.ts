/**
 * 创建带 status/code 的 HTTP 错误。
 */
export function httpError(status: number, code: string, message?: string): Error & {
  status: number;
  code: string;
} {
  const err = new Error(message ?? code) as Error & { status: number; code: string };
  err.status = status;
  err.code = code;
  return err;
}


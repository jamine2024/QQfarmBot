import type { RequestHandler } from "express";

/**
 * 将 async handler 的异常交给 Express 错误处理中间件。
 */
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}


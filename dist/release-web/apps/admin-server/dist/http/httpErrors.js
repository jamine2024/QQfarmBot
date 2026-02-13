/**
 * 创建带 status/code 的 HTTP 错误。
 */
export function httpError(status, code, message) {
    const err = new Error(message ?? code);
    err.status = status;
    err.code = code;
    return err;
}

import { verifyAccessToken } from "./jwt.js";
/**
 * 解析 Authorization: Bearer <token> 并写入 req.auth。
 */
export function requireAuth(jwtSecret) {
    return (req, res, next) => {
        const header = req.header("authorization") ?? "";
        const [kind, token] = header.split(" ");
        if (kind !== "Bearer" || !token) {
            res.status(401).json({ error: "UNAUTHORIZED" });
            return;
        }
        try {
            req.auth = verifyAccessToken(jwtSecret, token);
            next();
        }
        catch {
            res.status(401).json({ error: "UNAUTHORIZED" });
        }
    };
}
/**
 * 限制接口仅允许指定角色访问。
 */
export function requireRole(role) {
    return (req, res, next) => {
        if (!req.auth) {
            res.status(401).json({ error: "UNAUTHORIZED" });
            return;
        }
        if (role === "viewer")
            return next();
        if (req.auth.role !== "admin") {
            res.status(403).json({ error: "FORBIDDEN" });
            return;
        }
        next();
    };
}

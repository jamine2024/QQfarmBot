import jwt from "jsonwebtoken";
export function signAccessToken(secret, user, expiresIn = "12h") {
    const claims = {
        sub: user.id,
        username: user.username,
        role: user.role,
    };
    const options = { expiresIn };
    return jwt.sign(claims, secret, options);
}
export function verifyAccessToken(secret, token) {
    const decoded = jwt.verify(token, secret);
    return decoded;
}

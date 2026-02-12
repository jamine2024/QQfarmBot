import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import type { PublicUser, Role } from "./types.js";

export type JwtClaims = {
  sub: string;
  username: string;
  role: Role;
};

export function signAccessToken(
  secret: string,
  user: PublicUser,
  expiresIn: SignOptions["expiresIn"] = "12h"
): string {
  const claims: JwtClaims = {
    sub: user.id,
    username: user.username,
    role: user.role,
  };
  const options: SignOptions = { expiresIn };
  return jwt.sign(claims, secret, options);
}

export function verifyAccessToken(secret: string, token: string): JwtClaims {
  const decoded = jwt.verify(token, secret);
  return decoded as JwtClaims;
}

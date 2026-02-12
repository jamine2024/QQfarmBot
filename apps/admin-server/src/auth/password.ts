import crypto from "node:crypto";

type ScryptHash = {
  algorithm: "scrypt";
  saltB64: string;
  hashB64: string;
  keyLen: number;
  N: number;
  r: number;
  p: number;
};

const DEFAULT_PARAMS: Pick<ScryptHash, "N" | "r" | "p" | "keyLen"> = {
  N: 16384,
  r: 8,
  p: 1,
  keyLen: 64,
};

/**
 * 对明文密码进行哈希（scrypt），用于安全存储。
 */
export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, DEFAULT_PARAMS.keyLen, {
    N: DEFAULT_PARAMS.N,
    r: DEFAULT_PARAMS.r,
    p: DEFAULT_PARAMS.p,
  });
  const payload: ScryptHash = {
    algorithm: "scrypt",
    saltB64: salt.toString("base64"),
    hashB64: Buffer.from(hash).toString("base64"),
    keyLen: DEFAULT_PARAMS.keyLen,
    N: DEFAULT_PARAMS.N,
    r: DEFAULT_PARAMS.r,
    p: DEFAULT_PARAMS.p,
  };
  return `scrypt$${payload.N}$${payload.r}$${payload.p}$${payload.keyLen}$${payload.saltB64}$${payload.hashB64}`;
}

/**
 * 校验明文密码与存储哈希是否匹配。
 */
export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 7) return false;
  const [algo, N, r, p, keyLen, saltB64, hashB64] = parts;
  if (algo !== "scrypt") return false;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const derived = crypto.scryptSync(plain, salt, Number(keyLen), {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(derived, expected);
}

function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}


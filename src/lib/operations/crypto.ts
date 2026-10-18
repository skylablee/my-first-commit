import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  timingSafeEqual,
  createHmac,
} from "node:crypto";
import { AppError } from "../server/errors";
function key() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw || !/^[a-fA-F0-9]{64}$/.test(raw))
    throw new AppError(
      "CONFIG_MISSING",
      "토큰 암호화 키를 서버에 설정해 주세요.",
      503,
    );
  return Buffer.from(raw, "hex");
}
export function encrypt(value: string, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}
export function decrypt(value: string, context: string) {
  try {
    const [version, iv, tag, body] = value.split(".");
    if (version !== "v1" || !iv || !tag || !body) throw new Error();
    const cipher = createDecipheriv(
      "aes-256-gcm",
      key(),
      Buffer.from(iv, "base64url"),
    );
    cipher.setAAD(Buffer.from(context));
    cipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      cipher.update(Buffer.from(body, "base64url")),
      cipher.final(),
    ]).toString("utf8");
  } catch {
    throw new AppError(
      "TOKEN_ERROR",
      "연결 자격증명을 읽지 못했습니다. 연결을 다시 설정해 주세요.",
      503,
    );
  }
}
export function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export function secureEqual(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function privateIdentity(value: string) {
  const secret = process.env.CRON_SECRET || process.env.TOKEN_ENCRYPTION_KEY;
  if (!secret)
    throw new AppError(
      "CONFIG_MISSING",
      "서버 요청 제한 키를 설정해 주세요.",
      503,
    );
  return createHmac("sha256", secret).update(value).digest("hex");
}

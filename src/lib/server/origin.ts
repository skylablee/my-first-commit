import { AppError } from "./errors";
// Next's internal Request URL can use 0.0.0.0 when bound to all interfaces.
// Use the actual HTTP Host. Do not accept x-forwarded-host overrides.
export function requestOrigin(request: Request) {
  const internal = new URL(request.url);
  const host = request.headers.get("host") ?? internal.host;
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const protocol =
    forwardedProto === "https" || forwardedProto === "http"
      ? `${forwardedProto}:`
      : internal.protocol;
  let origin: URL;
  try {
    origin = new URL(`${protocol}//${host}`);
  } catch {
    throw new AppError("INVALID_ORIGIN", "허용되지 않은 요청입니다.", 403);
  }
  if (origin.host !== host || !["http:", "https:"].includes(protocol))
    throw new AppError("INVALID_ORIGIN", "허용되지 않은 요청입니다.", 403);
  return origin.origin;
}

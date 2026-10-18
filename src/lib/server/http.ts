import { AppError } from "./errors.ts";
export async function externalRequest(
  url: string,
  options: RequestInit = {},
  retry = 0,
  timeoutMs?: number,
): Promise<Response> {
  // AI POSTs are never automatically retried: a timeout may still incur a charge.
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(
          timeoutMs ?? (options.method === "POST" ? 45000 : 10000),
        ),
      });
      if (retry > attempt && [502, 503, 504].includes(response.status)) {
        await response.body?.cancel();
        continue;
      }
      return response;
    } catch (error) {
      if (attempt < retry) continue;
      if(error instanceof Error&&["AbortError","TimeoutError"].includes(error.name))throw new AppError("UPSTREAM_TIMEOUT","외부 서비스 응답 시간이 초과되었습니다.",504);
      throw new AppError(
        "UPSTREAM_UNAVAILABLE",
        "외부 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        502,
      );
    }
  }
}
export async function boundedText(response: Response, maxBytes = 1_000_000) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes)
        throw new AppError(
          "RESPONSE_TOO_LARGE",
          "외부 응답이 너무 큽니다.",
          502,
        );
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
export async function externalJSON(response: Response): Promise<unknown> {
  try {
    return JSON.parse(await boundedText(response));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "INVALID_RESPONSE",
      "외부 서비스 응답을 처리하지 못했습니다.",
      502,
    );
  }
}

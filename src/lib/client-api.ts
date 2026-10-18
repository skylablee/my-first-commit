export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    signal: AbortSignal.timeout(110000),
  }).catch(() => {
    throw new Error(
      "서버 연결이 끊겼거나 응답 시간이 초과되었습니다. 저장·사용량을 확인한 후 다시 시도해 주세요.",
    );
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("서버 응답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  if (!response.ok) {
    if (response.status === 401 && path !== "/api/auth")
      window.location.replace("/login");
    throw new Error(
      `${data.error?.message ?? "요청에 실패했습니다."}${data.error?.request_id ? ` (요청 ID: ${data.error.request_id})` : ""}`,
    );
  }
  return data as T;
}

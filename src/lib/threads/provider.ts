import "server-only";
import { z } from "zod";
import { externalRequest, externalJSON } from "../server/http";
import { AppError } from "../server/errors";
export class ThreadsError extends AppError {
  constructor(
    code: string,
    message: string,
    public retryable = false,
    public uncertain = false,
  ) {
    super(code, message, 502);
  }
}
export type ThreadsToken = { accessToken: string; expiresIn: number };
export interface ThreadsProvider {
  postLink?(token: string, id: string): Promise<string | null>;
  exchangeCode(code: string): Promise<ThreadsToken>;
  profile(token: string): Promise<{ id: string; username: string }>;
  createContainer(token: string, userId: string, text: string): Promise<string>;
  containerStatus(token: string, id: string): Promise<string>;
  publishContainer(
    token: string,
    userId: string,
    containerId: string,
  ): Promise<string>;
}
const idSchema = z.object({ id: z.string().regex(/^\d+$/) });
export class MetaThreadsProvider implements ThreadsProvider {
  private async call(
    path: string,
    token: string,
    body?: Record<string, string>,
    publishing = false,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await externalRequest(
        `https://graph.threads.net/v1.0/${path}`,
        {
          method: body ? "POST" : "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            ...(body
              ? { "Content-Type": "application/x-www-form-urlencoded" }
              : {}),
          },
          ...(body ? { body: new URLSearchParams(body).toString() } : {}),
        },
        0,
        15000,
      );
    } catch {
      throw new ThreadsError(
        "THREADS_UNAVAILABLE",
        "Threads 응답을 확인하지 못했습니다.",
        !publishing,
        publishing,
      );
    }
    if (!response.ok)
      throw new ThreadsError(
        "THREADS_API_ERROR",
        response.status === 401 || response.status === 403
          ? "Threads 연결이 만료되었거나 게시 권한이 없습니다. 다시 연결해 주세요."
          : response.status === 429
            ? "Threads 게시 요청 한도를 초과했습니다."
            : "Threads 요청이 거절되었습니다. 연결 권한과 콘텐츠를 확인해 주세요.",
        response.status === 429 || (!publishing && response.status >= 500),
        publishing && response.status >= 500,
      );
    return externalJSON(response);
  }
  async postLink(token: string, id: string) {
    if (!/^\d+$/.test(id)) return null;
    const value = z
      .object({ permalink: z.url() })
      .safeParse(await this.call(`${id}?fields=permalink`, token));
    if (!value.success) return null;
    const link = new URL(value.data.permalink);
    return link.protocol === "https:" &&
      [
        "www.threads.net",
        "threads.net",
        "www.threads.com",
        "threads.com",
      ].includes(link.hostname) &&
      !link.username &&
      !link.password
      ? link.toString()
      : null;
  }
  async exchangeCode(code: string) {
    const appId = process.env.THREADS_APP_ID,
      secret = process.env.THREADS_APP_SECRET,
      redirect = process.env.THREADS_REDIRECT_URI;
    if (!appId || !secret || !redirect)
      throw new AppError(
        "CONFIG_MISSING",
        "Threads 앱 환경변수를 설정해 주세요.",
        503,
      );
    const r = await externalRequest(
      "https://graph.threads.net/oauth/access_token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: appId,
          client_secret: secret,
          grant_type: "authorization_code",
          redirect_uri: redirect,
          code,
        }).toString(),
      },
    );
    if (!r.ok)
      throw new AppError(
        "THREADS_OAUTH",
        "Threads 인증 코드를 교환하지 못했습니다. 다시 연결해 주세요.",
        502,
      );
    const short = z
      .object({ access_token: z.string().min(1) })
      .safeParse(await externalJSON(r));
    if (!short.success)
      throw new AppError(
        "THREADS_OAUTH",
        "Threads 인증 응답이 올바르지 않습니다.",
        502,
      );
    // Meta's documented long-lived exchange is GET. Do not log this URL (it contains credentials).
    const url = new URL("https://graph.threads.net/access_token");
    url.search = new URLSearchParams({
      grant_type: "th_exchange_token",
      client_secret: secret,
      access_token: short.data.access_token,
    }).toString();
    const long = await externalRequest(url.toString());
    if (!long.ok)
      throw new AppError(
        "THREADS_OAUTH",
        "장기 Threads 토큰을 발급하지 못했습니다. 다시 연결해 주세요.",
        502,
      );
    const parsed = z
      .object({
        access_token: z.string().min(1),
        expires_in: z
          .number()
          .positive()
          .max(90 * 86400),
      })
      .safeParse(await externalJSON(long));
    if (!parsed.success)
      throw new AppError(
        "THREADS_OAUTH",
        "Threads 토큰 응답 형식이 변경되었습니다.",
        502,
      );
    return {
      accessToken: parsed.data.access_token,
      expiresIn: parsed.data.expires_in,
    };
  }
  async profile(token: string) {
    const value = z
      .object({ id: z.string().regex(/^\d+$/), username: z.string().max(200) })
      .safeParse(await this.call("me?fields=id,username", token));
    if (!value.success)
      throw new AppError(
        "THREADS_PROFILE",
        "Threads 계정 정보를 읽지 못했습니다.",
        502,
      );
    return value.data;
  }
  async createContainer(token: string, userId: string, text: string) {
    if (!/^\d+$/.test(userId) || Array.from(text).length > 500 || !text.trim())
      throw new ThreadsError(
        "THREADS_TEXT_LIMIT",
        "Threads 본문은 1~500자로 작성해 주세요.",
      );
    const value = idSchema.safeParse(
      await this.call(`${userId}/threads`, token, { media_type: "TEXT", text }),
    );
    if (!value.success)
      throw new ThreadsError(
        "THREADS_RESPONSE",
        "Threads 게시 준비 응답이 올바르지 않습니다.",
      );
    return value.data.id;
  }
  async containerStatus(token: string, id: string) {
    if (!/^\d+$/.test(id))
      throw new ThreadsError(
        "THREADS_RESPONSE",
        "게시 준비 ID가 올바르지 않습니다.",
      );
    const value = z
      .object({
        status: z.enum([
          "IN_PROGRESS",
          "FINISHED",
          "ERROR",
          "EXPIRED",
          "PUBLISHED",
        ]),
      })
      .safeParse(await this.call(`${id}?fields=id,status`, token));
    if (!value.success)
      throw new ThreadsError(
        "THREADS_RESPONSE",
        "게시 준비 상태를 읽지 못했습니다.",
      );
    return value.data.status;
  }
  async publishContainer(token: string, userId: string, containerId: string) {
    if (!/^\d+$/.test(userId) || !/^\d+$/.test(containerId))
      throw new ThreadsError(
        "THREADS_RESPONSE",
        "게시 ID가 올바르지 않습니다.",
      );
    const value = idSchema.safeParse(
      await this.call(
        `${userId}/threads_publish`,
        token,
        { creation_id: containerId },
        true,
      ),
    );
    if (!value.success)
      throw new ThreadsError(
        "THREADS_UNCERTAIN",
        "Threads 게시 결과를 확인할 수 없습니다.",
        false,
        true,
      );
    return value.data.id;
  }
}

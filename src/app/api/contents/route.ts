import { audit } from "@/lib/operations/audit";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { route, checkOrigin, parseBody, dbError } from "@/lib/server/api";
import { contentInput, uuid, platforms, platformCodes } from "@/lib/contracts";
import { toContent } from "@/lib/server/mappers";
import { AppError } from "@/lib/server/errors";
const cursorSchema = z.object({
  created_at: z.iso.datetime({ offset: true }),
  id: z.uuid(),
});
export async function GET(request: Request) {
  return route(async () => {
    const { db, user } = await requireUser();
    const url = new URL(request.url);
    let query = db
      .from("contents")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(100);
    const brandId = url.searchParams.get("brand_id");
    if (brandId) query = query.eq("brand_id", uuid.parse(brandId));
    const cursor = url.searchParams.get("cursor");
    if (cursor) {
      let c: z.infer<typeof cursorSchema>;
      try {
        c = cursorSchema.parse(
          JSON.parse(Buffer.from(cursor, "base64url").toString()),
        );
      } catch {
        throw new AppError("VALIDATION_ERROR", "잘못된 페이지 정보입니다.");
      }
      query = query.or(
        `created_at.lt.${c.created_at},and(created_at.eq.${c.created_at},id.lt.${c.id})`,
      );
    }
    const { data, error } = await query;
    dbError(error);
    const rows = data ?? [];
    const last = rows.at(-1);
    return {
      contents: rows.map(toContent),
      nextCursor:
        rows.length === 100 && last
          ? Buffer.from(
              JSON.stringify({ id: last.id, created_at: last.created_at }),
            ).toString("base64url")
          : null,
    };
  });
}
async function save(request: Request, update: boolean) {
  return route(async () => {
    checkOrigin(request);
    const { db, user } = await requireUser();
    const input = await parseBody(request, contentInput);
    const { data: brand, error: brandError } = await db
      .from("brands")
      .select("id")
      .eq("id", input.brand_id)
      .eq("user_id", user.id)
      .single();
    dbError(brandError);
    if (!brand) throw new AppError("NOT_FOUND", "브랜드가 없습니다.", 404);
    const row = {
      brand_id: input.brand_id,
      user_id: user.id,
      title: input.title,
      body: input.body,
      platform: platformCodes[platforms.indexOf(input.channel)],
      source_type: input.source_type,
      source_url: input.source_url || null,
    };
    if (update && !input.id)
      throw new AppError("VALIDATION_ERROR", "수정할 콘텐츠를 선택해 주세요.");
    // Only draft content can be edited; publishing requires a future server workflow.
    const query = update
      ? db
          .from("contents")
          .update(row)
          .eq("id", input.id!)
          .eq("user_id", user.id)
          .eq("status", "draft")
      : db.from("contents").insert({
          ...row,
          ...(input.id ? { id: input.id } : {}),
          status: "draft",
        });
    const { data, error } = await query.select("*").single();
    dbError(error);
    if (!data) throw new AppError("NOT_FOUND", "수정할 초안이 없습니다.", 404);
    await audit(
      user.id,
      update ? "content.update" : "content.create",
      "content",
      data.id,
    );
    return { content: toContent(data) };
  });
}
export async function POST(request: Request) {
  return save(request, false);
}
export async function PATCH(request: Request) {
  return save(request, true);
}
export async function DELETE(request: Request) {
  return route(async () => {
    checkOrigin(request);
    const { db, user } = await requireUser();
    const id = uuid.parse(new URL(request.url).searchParams.get("id"));
    const { data, error } = await db
      .from("contents")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id");
    dbError(error);
    if (!data?.length)
      throw new AppError("NOT_FOUND", "콘텐츠가 없습니다.", 404);
    await audit(user.id, "content.delete", "content", id);
    return { ok: true };
  });
}

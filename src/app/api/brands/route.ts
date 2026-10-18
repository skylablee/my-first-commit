import { effectivePlan } from "@/lib/operations/guards";
import { plans } from "@/lib/plans";
import { audit } from "@/lib/operations/audit";
import { requireUser } from "@/lib/server/auth";
import { route, checkOrigin, parseBody, dbError } from "@/lib/server/api";
import { brandInput, uuid } from "@/lib/contracts";
import { toBrand } from "@/lib/server/mappers";
import { AppError } from "@/lib/server/errors";
export async function GET() {
  return route(async () => {
    const { db, user } = await requireUser();
    const { data, error } = await db
      .from("brands")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at")
      .order("id")
      .limit(50);
    dbError(error);
    const plan = await effectivePlan(user.id);
    return {
      brands: (data ?? []).map((row, index) => ({
        ...toBrand(row),
        active: index < plans[plan].brands,
      })),
    };
  });
}
async function save(request: Request, update: boolean) {
  return route(async () => {
    checkOrigin(request);
    const { db, user } = await requireUser();
    const input = await parseBody(request, brandInput);
    const row = {
      user_id: user.id,
      brand_name: input.name,
      industry: input.industry,
      target_customer: input.audience,
      tone: input.voice,
      description: input.description,
      website: input.website,
      blog_url: input.blog_url,
      instagram: input.instagram,
      threads: input.threads,
      keywords: input.keywords,
      forbidden_words: input.forbidden_words,
    };
    if (update && !input.id)
      throw new AppError("VALIDATION_ERROR", "수정할 브랜드를 선택해 주세요.");
    const query = update
      ? db.from("brands").update(row).eq("id", input.id!).eq("user_id", user.id)
      : db.from("brands").insert(row);
    const { data, error } = await query.select("*").single();
    dbError(error);
    if (!data) throw new AppError("NOT_FOUND", "브랜드가 없습니다.", 404);
    await audit(
      user.id,
      update ? "brand.update" : "brand.create",
      "brand",
      data.id,
    );
    return { brand: toBrand(data) };
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
      .from("brands")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id");
    dbError(error);
    if (!data?.length)
      throw new AppError("NOT_FOUND", "브랜드가 없습니다.", 404);
    await audit(user.id, "brand.delete", "brand", id);
    return { ok: true };
  });
}

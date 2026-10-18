import { test } from "vitest";
import assert from "node:assert/strict";
import {
  defaultBrand,
  initialContent,
  generateMockContent,
} from "../src/lib/content.ts";
test("brand, topic and selected channel are reflected in a generated draft", () => {
  const result = generateMockContent(
    { ...defaultBrand, name: "테스트 카페", voice: "정중한" },
    "신메뉴 소개",
    "카카오 채널",
  );
  for (const value of [
    "테스트 카페",
    "정중한",
    "신메뉴 소개",
    "카카오 채널",
    "데모 템플릿",
  ])
    assert.ok(result.includes(value));
});
test("empty and oversized topics cannot be generated", () => {
  for (const topic of ["", "   ", "가".repeat(301)])
    assert.throws(() => generateMockContent(defaultBrand, topic, "인스타그램"));
  assert.ok(generateMockContent(defaultBrand, "가".repeat(300), "인스타그램"));
});
test("initial library has unique IDs and all lifecycle states", () => {
  assert.equal(
    new Set(initialContent.map((c) => c.id)).size,
    initialContent.length,
  );
  for (const status of ["초안", "예약됨", "발행됨"])
    assert.ok(initialContent.some((c) => c.status === status));
});

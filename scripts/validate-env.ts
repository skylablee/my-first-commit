import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
import { validateEnvironment } from "../src/lib/environment.ts";
loadEnvConfig(process.cwd());
const result = validateEnvironment();
if (!result.valid) {
  console.error(
    "환경 검증 실패 (" +
      result.stage +
      "):\n" +
      result.errors.map((e) => " - " + e).join("\n"),
  );
  process.exit(1);
}
console.log(
  "환경 검증 통과: " + result.stage + " (자격증명 유효성·실연결 검증은 별도)",
);

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Сгенерированное: папки сборки параллельных дев-серверов (NEXT_DIST_DIR),
    // собранный worklet голоса (scripts/build-audio.mjs), локальный стенд.
    ".next-*/**",
    "public/audio/**",
    ".dev-stack/**",
  ]),
]);

export default eslintConfig;

// Собирает обработку голоса в public/audio — Next отдаёт её как обычную статику:
//  • voice-processor.js — AudioWorklet из src/lib/audio/worklet (esbuild, один файл);
//  • rnnoise.wasm, rnnoise_simd.wasm — RNNoise из @sapphi-red/web-noise-suppressor.
//
// Почему не через бандлер Next: worklet исполняется в отдельном аудиопотоке и
// грузится по URL через audioWorklet.addModule, wasm — тоже по URL.
//
// Запускается перед `dev` и `build` (см. package.json); после правки кода worklet —
// `npm run audio:build`. Результат в git не идёт (см. .gitignore).
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "audio");
const wasmSrc = join(root, "node_modules", "@sapphi-red", "web-noise-suppressor", "dist");

await mkdir(out, { recursive: true });
await build({
  entryPoints: [join(root, "src", "lib", "audio", "worklet", "voiceProcessor.ts")],
  outfile: join(out, "voice-processor.js"),
  bundle: true,
  format: "esm",
  // AudioWorklet есть с Chrome 66 / Firefox 76 / Safari 14.1 — ES2020 им всем по силам.
  target: "es2020",
  minify: true,
  sourcemap: "linked",
  legalComments: "none",
  logLevel: "warning",
});
await Promise.all(["rnnoise.wasm", "rnnoise_simd.wasm"].map((f) => copyFile(join(wasmSrc, f), join(out, f))));
await writeFile(
  join(out, "NOTICE.txt"),
  [
    "voice-processor.js — обработка голоса Game Room.",
    "rnnoise.wasm, rnnoise_simd.wasm — RNNoise (BSD-3-Clause, Copyright (c) 2017 Jean-Marc Valin, Xiph.Org, Mozilla),",
    "  wasm-сборка @shiguredo/rnnoise-wasm (Apache-2.0), поставка @sapphi-red/web-noise-suppressor (MIT).",
    "",
  ].join("\n"),
);
console.log("[audio] public/audio: voice-processor.js, rnnoise.wasm, rnnoise_simd.wasm");

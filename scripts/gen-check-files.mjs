// Генератор тестовых файлов для страницы /check («Проверка связи»).
//
// Файлы нужны, чтобы с телефона или компьютера друга замерить, не «замерзает» ли
// скачивание после ~16 КБ (метод провайдеров РФ).
// Содержимое: псевдослучайные байты. Они не сжимаются ни gzip, ни zstd на пути
// (Caddy, провайдер), поэтому на проводе ровно столько байт, сколько в файле.
//
// Файлы детерминированные: байты блока i = SHA-256("game-room-check-v1:" + i).
// Запуск в любом месте даёт те же самые файлы, так что в git они не «гуляют».
//
// Запуск из корня репозитория:
//   node scripts/gen-check-files.mjs
// Проверка без записи (сравнить с тем, что лежит в public/check/):
//   node scripts/gen-check-files.mjs --check
//
// Размеры и имена должны совпадать с TEST_FILES в src/app/check/_lib/constants.ts
// (это проверяет тест constants.test.ts).

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SEED = "game-room-check-v1";
const KB = 1024;

export const FILES = [
  { name: "test-16kb.bin", bytes: 16 * KB },
  { name: "test-64kb.bin", bytes: 64 * KB },
  { name: "test-300kb.bin", bytes: 300 * KB },
  { name: "test-1mb.bin", bytes: 1024 * KB },
];

/** Детерминированные несжимаемые байты нужной длины. */
export function makeBytes(length) {
  const out = Buffer.alloc(length);
  let offset = 0;
  for (let i = 0; offset < length; i++) {
    const block = createHash("sha256").update(`${SEED}:${i}`).digest();
    const n = Math.min(block.length, length - offset);
    block.copy(out, offset, 0, n);
    offset += n;
  }
  return out;
}

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "..", "public", "check");

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const checkOnly = process.argv.includes("--check");
  let bad = 0;
  if (!checkOnly) mkdirSync(outDir, { recursive: true });
  for (const f of FILES) {
    const bytes = makeBytes(f.bytes);
    const path = join(outDir, f.name);
    if (checkOnly) {
      const same = existsSync(path) && readFileSync(path).equals(bytes);
      console.log(`${same ? "ок     " : "РАЗНЫЕ "} ${f.name} (${f.bytes} байт)`);
      if (!same) bad++;
    } else {
      writeFileSync(path, bytes);
      console.log(`записан ${f.name} (${f.bytes} байт)`);
    }
  }
  if (bad) process.exit(1);
}

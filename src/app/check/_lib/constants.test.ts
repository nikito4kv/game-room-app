import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { TEST_FILES } from "./constants";

// Тестовые файлы лежат в public/check/ и должны совпадать с тем, что делает генератор
// scripts/gen-check-files.mjs: те же имена, те же размеры, те же байты.

type Generator = { FILES: { name: string; bytes: number }[]; makeBytes: (n: number) => Buffer };
const GEN = resolve(process.cwd(), "scripts/gen-check-files.mjs");
const hasGenerator = existsSync(GEN);

describe.skipIf(!hasGenerator)("тестовые файлы проверки связи", () => {
  it("имена и размеры в коде страницы совпадают с генератором", async () => {
    const gen = (await import(/* @vite-ignore */ pathToFileURL(GEN).href)) as Generator;
    expect(TEST_FILES.map((f) => ({ name: f.name, bytes: f.bytes }))).toEqual(gen.FILES);
  });

  it("файлы в public/check/ на месте, нужного размера и совпадают с генератором байт в байт", async () => {
    const gen = (await import(/* @vite-ignore */ pathToFileURL(GEN).href)) as Generator;
    for (const f of TEST_FILES) {
      const path = resolve(process.cwd(), "public/check", f.name);
      expect(statSync(path).size, f.name).toBe(f.bytes);
      expect(readFileSync(path).equals(gen.makeBytes(f.bytes)), f.name).toBe(true);
    }
  });

  it("файлы не сжимаются (иначе по проводу пойдёт меньше байт, чем мы думаем)", () => {
    for (const f of TEST_FILES) {
      const raw = readFileSync(resolve(process.cwd(), "public/check", f.name));
      expect(gzipSync(raw).length / raw.length, f.name).toBeGreaterThan(0.99);
    }
  });

  it("каждый файл не больше 1 МБ", () => {
    for (const f of TEST_FILES) expect(f.bytes).toBeLessThanOrEqual(1024 * 1024);
  });
});

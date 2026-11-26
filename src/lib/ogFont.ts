import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Шрифты для OG-картинок (ImageResponse/satori) — те же, что на сайте:
 * Unbounded для заголовков и кода, Onest для подписей.
 *
 * Шрифт по умолчанию у ImageResponse без кириллицы — текст стал бы «тофу».
 * next/font тут не помогает (его файлы не отдаются сырым ArrayBuffer), а
 * satori не понимает woff2 и вариативные шрифты. Поэтому в assets/ лежат
 * статические TTF-начертания с Google Fonts (лицензия OFL — файлы OFL-*.txt
 * рядом). Читаем через fs (отсюда runtime = "nodejs" у image-роутов);
 * Dockerfile копирует assets/ в образ отдельно.
 */
export type OgFont = {
  name: string;
  data: Buffer;
  weight: 400 | 500 | 600 | 700;
  style: "normal";
};

/** Семейства — по ним satori выбирает шрифт из style.fontFamily. */
export const OG_FONT_BRAND = "Unbounded";
export const OG_FONT_BODY = "Onest";

const FILES: { name: string; file: string; weight: OgFont["weight"] }[] = [
  { name: OG_FONT_BRAND, file: "Unbounded-Bold.ttf", weight: 700 },
  { name: OG_FONT_BRAND, file: "Unbounded-SemiBold.ttf", weight: 600 },
  { name: OG_FONT_BODY, file: "Onest-Medium.ttf", weight: 500 },
  { name: OG_FONT_BODY, file: "Onest-Regular.ttf", weight: 400 },
];

// Файлы читаем один раз на процесс: краулер разворачивает ссылку несколько раз,
// а шрифты — почти мегабайт. Неудачное чтение не кэшируем.
let cached: Promise<OgFont[]> | null = null;

/** Шрифты в формате опции `fonts` у ImageResponse. */
export function loadOgFonts(): Promise<OgFont[]> {
  cached ??= Promise.all(
    FILES.map(async ({ name, file, weight }): Promise<OgFont> => ({
      name,
      data: await readFile(join(process.cwd(), "assets", file)),
      weight,
      style: "normal",
    })),
  ).catch((err: unknown) => {
    cached = null;
    throw err;
  });
  return cached;
}

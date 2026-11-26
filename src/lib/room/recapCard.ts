// Картинка «Итоги вечера» (PNG 1200×630) — для постинга в чат и соцсети. Как
// открытка Румика (src/lib/rumik/postcard.ts): собирается на холсте в браузере,
// никуда не уходит, цвета — токены «Эфира», логотип и Румик — SVG, которые React
// уже отрисовал на странице. Слева — итоги, справа — ваш Румик с поднятыми руками.
//
// Чистая часть — какие клетки показать (recapCells), её проверяет тест.

import {
  POSTCARD_SITE,
  backdropSvg,
  fitFontSize,
  inlineCssVars,
  loadImage,
  placed,
  postcardLayout,
  readPostcardColors,
  wrapSvg,
  type PostcardSources,
} from "@/lib/rumik/postcard";
import type { IconName } from "@/components/ui/icons";
import { plural } from "@/lib/plural";
import { formatSpan, type Recap } from "./recap";

export const RECAP_FILE_NAME = "itogi-vechera.png";
export const RECAP_TITLE = "Итоги вечера";

/** Клетка итогов: подпись мелко, значение крупно. */
export type RecapCell = { label: string; value: string };

/** До четырёх клеток по важности: время, компания, болтун, тише всех, реакции и звуки, кубик. */
export function recapCells(r: Recap): RecapCell[] {
  const cells: RecapCell[] = [{ label: "Вместе", value: formatSpan(r.durationMs) }];
  if (r.people > 1)
    cells.push({ label: "Компания", value: `${r.people} ${plural(r.people, ["человек", "человека", "человек"])}` });
  if (r.top) cells.push({ label: "Болтун вечера", value: `${r.top.name} · ${formatSpan(r.top.talkMs)}` });
  if (r.quiet) cells.push({ label: "Тише всех", value: r.quiet.name });
  if (r.reactions + r.sounds > 0) {
    const parts = [
      r.reactions ? `${r.reactions} ${plural(r.reactions, ["реакция", "реакции", "реакций"])}` : "",
      r.sounds ? `${r.sounds} ${plural(r.sounds, ["звук", "звука", "звуков"])}` : "",
    ].filter(Boolean);
    cells.push({ label: "Эмоции", value: parts.join(" · ") });
  }
  if (r.dice) cells.push({ label: "Кубик", value: `${r.dice} ${plural(r.dice, ["бросок", "броска", "бросков"])}` });
  return cells.slice(0, 4);
}

/** Плитка итогов в окне: значок, крупное значение и подпись. */
export type RecapTile = { icon: IconName; value: string; caption: string };

/**
 * Плитки под картинкой: что было за вечер, по одной на показатель. Нулевые не
 * показываем — пустая плитка «0 звуков» только шумит. Порядок — по значимости.
 */
export function recapTiles(r: Recap): RecapTile[] {
  const tiles: RecapTile[] = [{ icon: "history", value: formatSpan(r.durationMs), caption: "вместе" }];
  if (r.people > 1) {
    tiles.push({
      icon: "users",
      value: String(r.people),
      caption: plural(r.people, ["человек", "человека", "человек"]),
    });
  }
  if (r.top) tiles.push({ icon: "mic", value: r.top.name, caption: `болтун вечера · ${formatSpan(r.top.talkMs)}` });
  if (r.quiet) tiles.push({ icon: "headphones", value: r.quiet.name, caption: "тише всех" });
  if (r.reactions) {
    tiles.push({
      icon: "smile-plus",
      value: String(r.reactions),
      caption: plural(r.reactions, ["реакция", "реакции", "реакций"]),
    });
  }
  if (r.sounds) {
    tiles.push({ icon: "music", value: String(r.sounds), caption: plural(r.sounds, ["звук", "звука", "звуков"]) });
  }
  if (r.dice)
    tiles.push({ icon: "dice", value: String(r.dice), caption: plural(r.dice, ["бросок", "броска", "бросков"]) });
  return tiles;
}

/** Итоги одной фразой — для описания картинки скринридеру. */
export function recapSummary(r: Recap): string {
  return `Итоги вечера, ${recapSubtitle(r)}: ${recapTiles(r)
    .map((t) => `${t.value} ${t.caption}`)
    .join(", ")}.`;
}

/** «Вечерняя катка» · 6 октября — подзаголовок. */
export function recapSubtitle(r: Recap): string {
  const date = new Date(r.startedAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  return `«${r.title}» · ${date}`;
}

/** Текст, если строка шире maxWidth, — с «…» в конце. measure — ширина строки. */
export function ellipsize(text: string, maxWidth: number, measure: (s: string) => number): string {
  if (measure(text) <= maxWidth) return text;
  const chars = [...text];
  while (chars.length > 1 && measure(`${chars.join("")}…`) > maxWidth) chars.pop();
  return `${chars.join("").trimEnd()}…`;
}

const PAD = 72;
/** Строка итогов: подпись слева в своей колонке, значение крупно справа от неё. */
const LABEL_W = 176;
const ROW_STEP = 56;

/** Собрать картинку итогов. sources — Румик (поза cheer), знак и надпись логотипа. */
export async function renderRecapCard(r: Recap, sources: PostcardSources, scope: Element): Promise<Blob> {
  const style = getComputedStyle(scope);
  const read = (name: string) => style.getPropertyValue(name);
  const c = readPostcardColors(read);
  const L = postcardLayout("cheer");

  const canvas = document.createElement("canvas");
  canvas.width = L.width;
  canvas.height = L.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("recap: холст недоступен");
  ctx.fillStyle = c.canvas;
  ctx.fillRect(0, 0, L.width, L.height);

  const svg = inlineCssVars(
    wrapSvg(L.width, L.height, c.ink, [
      backdropSvg(L),
      placed(sources.mark, L.mark),
      placed(sources.word, L.word),
      placed(sources.rumik, L.rumik),
    ]),
    read,
  );
  const art = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  ctx.drawImage(art, 0, 0, L.width, L.height);

  const brand = (size: number) => `700 ${size}px ${c.fontBrand}`;
  const body = (size: number) => `500 ${size}px ${c.fontBody}`;
  const cells = recapCells(r);
  await Promise.all([
    document.fonts.load(brand(72), RECAP_TITLE + cells.map((x) => x.value).join("")),
    document.fonts.load(body(28), recapSubtitle(r) + cells.map((x) => x.label).join("") + POSTCARD_SITE),
  ]).catch(() => undefined);

  const maxText = L.title.maxWidth;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = c.ink;
  const titleSize = fitFontSize(
    (size) => {
      ctx.font = brand(size);
      return ctx.measureText(RECAP_TITLE).width;
    },
    maxText,
    72,
    44,
  );
  ctx.font = brand(titleSize);
  ctx.fillText(RECAP_TITLE, PAD, 214);

  ctx.font = body(28);
  ctx.fillStyle = c.ink2;
  ctx.fillText(
    ellipsize(recapSubtitle(r), maxText, (s) => ctx.measureText(s).width),
    PAD,
    262,
  );

  const valueW = maxText - LABEL_W;
  cells.forEach((cell, i) => {
    const y = 328 + i * ROW_STEP;
    ctx.font = body(22);
    ctx.fillStyle = c.ink2;
    ctx.fillText(
      ellipsize(cell.label, LABEL_W - 12, (s) => ctx.measureText(s).width),
      PAD,
      y,
    );
    const size = fitFontSize(
      (s) => {
        ctx.font = brand(s);
        return ctx.measureText(cell.value).width;
      },
      valueW,
      34,
      22,
    );
    ctx.font = brand(size);
    ctx.fillStyle = c.ink;
    ctx.fillText(
      ellipsize(cell.value, valueW, (s) => ctx.measureText(s).width),
      PAD + LABEL_W,
      y,
    );
  });

  ctx.font = body(L.site.size);
  ctx.fillStyle = c.ink2;
  ctx.fillText(POSTCARD_SITE, L.site.x, L.site.y);

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("recap: PNG не собрался"))), "image/png"),
  );
}

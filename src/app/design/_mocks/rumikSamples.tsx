// Образцы для витрин Румика (/design, /design/rumik, /design/pip): пример рисунка
// и неподвижный пузырь реакции. Без "use client": годится и серверной витрине.

import { cn } from "@/components/ui/cn";
import { Glyph, type GlyphSpec } from "@/components/ui/Glyph";
import { ARM, BODY, POSES, VIEW, handAt, type Shoulder } from "@/lib/rumik/geometry";
import { PAINT_PALETTE } from "@/lib/rumik/palette";

/** Краска по имени из палитры рисовалки: это цвет данных рисунка, а не интерфейса (§8). */
function ink(name: string): string {
  return (PAINT_PALETTE.find((s) => s.name === name) ?? PAINT_PALETTE[0]).hex;
}

/** Рукав в позе «стоит»: та же рамка руки, что у силуэта (Rumik.tsx). */
function sleeve([x, y, angle]: Shoulder, cuff: string, color: string): string {
  return (
    `<g transform="translate(${x} ${y}) rotate(${angle})">` +
    `<rect x="${-ARM.w / 2}" y="${ARM.top}" width="${ARM.w}" height="${ARM.h}" fill="${color}"/>` +
    `<rect x="${-ARM.w / 2}" y="36" width="${ARM.w}" height="8" fill="${cuff}"/>` +
    `</g>`
  );
}

function glove(shoulder: Shoulder, color: string): string {
  const [cx, cy] = handAt(shoulder);
  return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="17" fill="${color}"/>`;
}

const STAND = POSES.stand;
const LEFT = BODY.x;
const RIGHT = BODY.x + BODY.w;

const SAMPLE_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${VIEW.w}" height="${VIEW.h}" viewBox="${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}">` +
  // Рукава — первыми: всё, что под телом, достаётся телу (как у рисовалки).
  sleeve(STAND.l, ink("Белый"), ink("Коралл")) +
  sleeve(STAND.r, ink("Белый"), ink("Коралл")) +
  // Футболка с белой полосой, шорты и кеды.
  `<rect x="${LEFT}" y="${BODY.y}" width="${BODY.w}" height="${BODY.h}" fill="${ink("Лазурь")}"/>` +
  `<rect x="${LEFT}" y="113" width="${BODY.w}" height="8" fill="${ink("Белый")}"/>` +
  `<rect x="${LEFT}" y="127" width="${BODY.w}" height="45" fill="${ink("Барвинок")}"/>` +
  `<rect x="${LEFT + 16}" y="172" width="${RIGHT - LEFT - 32}" height="24" fill="${ink("Чёрный")}"/>` +
  // Перчатки — последними: кисти лежат поверх тела.
  glove(STAND.l, ink("Песок")) +
  glove(STAND.r, ink("Песок")) +
  `</svg>`;

/**
 * Пример рисунка для `<Rumik paint>`: футболка, рукава с манжетами, шорты, кеды
 * и перчатки на стоящем Румике. Настоящий рисунок — PNG слоя краски из
 * рисовалки (286×240 или 572×480); здесь SVG той же рамки VIEW, чтобы витрина
 * не тянула картинку. Цвета — краска рисунка из палитры рисовалки (palette.ts).
 */
export const SAMPLE_PAINT = `data:image/svg+xml,${encodeURIComponent(SAMPLE_SVG)}`;

/**
 * Неподвижный пузырь реакции — как ReactionBubble в комнате (кружок 36 px,
 * значок из набора, «GG» шрифтом бренда), но без хранилища и таймера:
 * для витрин.
 * Позицию задаёт обёртка через className.
 */
export function ReactionBubbleSample({ glyph, className }: { glyph: GlyphSpec; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("pointer-events-none absolute z-10", className)}>
      <span
        className={cn(
          "grid h-9 min-w-9 place-items-center rounded-full border border-line bg-overlay px-2 shadow-float",
          "select-none whitespace-nowrap leading-none",
        )}
      >
        <Glyph spec={glyph} size={20} />
      </span>
    </span>
  );
}

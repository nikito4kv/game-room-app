// Открытка «Мой Румик» (R5): PNG 1200×630 для соцсетей и чатов. Собирается в
// браузере на холсте: рисунок никуда не уходит, публичной ссылки на него нет.
// Стиль — как у OG-карточек сайта (src/lib/ogCard.tsx): графитовый фон, логотип
// в углу, крупная надпись Unbounded, свет лампы над фигурой.
//
// Цвета — вычисленные значения токенов --gr-* (getComputedStyle), своих нет.
// Румика и логотип не рисуем заново: берём SVG, который React уже отрисовал на
// странице (<Rumik paint … />, <Logo />), подставляем вместо var(--gr-…) значения
// и кладём на холст картинкой. Текст — на самом холсте: SVG-картинка не видит
// шрифтов страницы, а холсту Unbounded и Onest доступны через document.fonts.
//
// Чистые части (раскладка, подстановка цветов, подбор кегля) — без DOM, их
// проверяет postcard.test.ts; сборка — renderPostcard внизу.

import type { RumikEyes } from "@/components/ui/Rumik";
import { AXIS_X, BODY, HAND_R, LEG, POSES, STROKE, VIEW, handAt, type RumikPose } from "./geometry";

export const POSTCARD_SIZE = { width: 1200, height: 630 } as const;
export const POSTCARD_FILE_NAME = "moy-rumik.png";
export const POSTCARD_TITLE = ["Мой", "Румик"] as const;
export const POSTCARD_SITE = "game-room.space";

export type PostcardPoseOption = { pose: RumikPose; label: string; eyes?: RumikEyes };

/** Позы на выбор: рисуют всегда стоящего Румика, в остальных руки и ноги едут вместе с краской. */
export const POSTCARD_POSES: readonly PostcardPoseOption[] = [
  { pose: "stand", label: "Стоит" },
  { pose: "wave", label: "Машет", eyes: "wink" },
  { pose: "cheer", label: "Ура", eyes: "wide" },
  { pose: "sit", label: "Сидит" },
  { pose: "point", label: "Показывает" },
  { pose: "hold", label: "Держит" },
];

export type Box = { x: number; y: number; w: number; h: number };

export type PostcardLayout = {
  width: number;
  height: number;
  /** Знак и надпись логотипа — как Logo variant="lockup". */
  mark: Box;
  word: Box;
  /** Румик в рамке VIEW (286×240), масштаб — по ширине фигуры в позе. */
  rumik: Box;
  /** Свет лампы за фигурой. */
  lamp: { x: number; y: number; r: number };
  /** «Коврик» под ногами — как в рисовалке. */
  floor: { x: number; y: number; rx: number; ry: number };
  /** «Мой Румик»: первая базовая линия, шаг строк, наибольший кегль и ширина колонки. */
  title: { x: number; y: number; size: number; lineHeight: number; maxWidth: number };
  /** «game-room.space» внизу слева (базовая линия). */
  site: { x: number; y: number; size: number };
};

const PAD = 72;
/** Логотип: высота знака; надпись — 0.62 от неё, зазор 0.32 (как Logo lockup). */
const LOGO_H = 44;
/** Ширина надписи логотипа к высоте: viewBox -0.5 5.5 142.3 22. */
const WORD_ASPECT = 142.3 / 22;
/** Место под Румика справа: от конца колонки текста до правого поля. */
const AREA = { left: 620, right: 1152 } as const;
/** Наибольший масштаб Румика (единиц мира в px): стоящий занимает ~460 px в ширину. */
const MAX_SCALE = 2.1;
/** Линия, на которой стоят ноги. */
const FEET_Y = 520;
/** Низ ног в мировых координатах Румика. */
const FEET_WORLD = LEG.y + LEG.h;
/** Поля вокруг силуэта: половина обводки и белый край наклейки (Rumik: STROKE и 19). */
const EDGE = STROKE / 2 + 19 / 2;

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Ширина фигуры в позе (мировые координаты, с наклейкой): руки в разные позы
 * уходят в стороны по-разному — «держит» шире всех.
 */
export function figureExtent(pose: RumikPose): { left: number; right: number } {
  const p = POSES[pose] ?? POSES.stand;
  const [hl, hr] = [handAt(p.l), handAt(p.r)];
  return {
    left: Math.min(BODY.x, hl[0] - HAND_R) - EDGE,
    right: Math.max(BODY.x + BODY.w, hr[0] + HAND_R) + EDGE,
  };
}

/**
 * Раскладка открытки. Текст слева, Румик справа: фигура в позе вписана в своё
 * место по ширине (не крупнее MAX_SCALE) и стоит посередине; ноги — на одной линии.
 */
export function postcardLayout(pose: RumikPose = "stand"): PostcardLayout {
  const { width, height } = POSTCARD_SIZE;
  const ext = figureExtent(pose);
  const scale = Math.min(MAX_SCALE, (AREA.right - AREA.left) / (ext.right - ext.left));
  const mid = (AREA.left + AREA.right) / 2;
  const x = mid - ((ext.left + ext.right) / 2 - VIEW.x) * scale;
  const y = FEET_Y - (FEET_WORLD - VIEW.y) * scale;
  const rumik: Box = { x: round1(x), y: round1(y), w: round1(VIEW.w * scale), h: round1(VIEW.h * scale) };
  const bodyX = x + (AXIS_X - VIEW.x) * scale;
  const bodyY = y + (BODY.y + BODY.h / 2 - VIEW.y) * scale;
  const wordH = Math.round(LOGO_H * 0.62);
  return {
    width,
    height,
    mark: { x: PAD, y: PAD, w: LOGO_H, h: LOGO_H },
    word: {
      x: PAD + LOGO_H + Math.round(LOGO_H * 0.32),
      y: PAD + (LOGO_H - wordH) / 2 + Math.round(wordH * 0.16),
      w: round1(wordH * WORD_ASPECT),
      h: wordH,
    },
    rumik,
    lamp: { x: round1(bodyX), y: round1(bodyY), r: 380 },
    floor: { x: round1(bodyX), y: FEET_Y + 4, rx: round1(104 * scale), ry: 30 },
    title: { x: PAD, y: 300, size: 124, lineHeight: 128, maxWidth: AREA.left - PAD - 24 },
    site: { x: PAD, y: height - PAD, size: 32 },
  };
}

/**
 * Наибольший кегль от `max` до `min` (шаг 2), при котором строка влезает в
 * `maxWidth`. `measure(size)` — ширина строки этим кеглем (на холсте — measureText).
 */
export function fitFontSize(measure: (size: number) => number, maxWidth: number, max: number, min: number): number {
  for (let size = max; size > min; size -= 2) if (measure(size) <= maxWidth) return size;
  return min;
}

// ── Цвета ────────────────────────────────────────────────────────────────────

/** Токены, которые нужны холсту: фон и текст. Остальные цвета — в SVG (var(--gr-…), их подставляет inlineCssVars). */
export const POSTCARD_TOKENS = {
  canvas: "--gr-canvas",
  ink: "--gr-ink",
  ink2: "--gr-ink-2",
  fontBrand: "--gr-font-brand",
  fontBody: "--gr-font-body",
} as const;

export type PostcardColors = Record<keyof typeof POSTCARD_TOKENS, string>;

/** Значения токенов холста. Нет хоть одного (страница без tokens.css) — ошибка: своих цветов у открытки нет. */
export function readPostcardColors(read: (name: string) => string): PostcardColors {
  const out = {} as PostcardColors;
  for (const [key, name] of Object.entries(POSTCARD_TOKENS) as [keyof PostcardColors, string][]) {
    const value = read(name).trim();
    if (!value) throw new Error(`postcard: нет токена ${name}`);
    out[key] = value;
  }
  return out;
}

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

// var(--имя) или var(--имя, запасное); запасное — без вложенных скобок либо с одним уровнем: rgb(…).
const CSS_VAR = /var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g;

/**
 * Подставить вместо var(--…) значения: SVG-картинка на холсте не видит стилей
 * страницы. Нет значения — запасное из var(), нет и его — var() остаётся (его
 * поймает тест). Значения экранируются: они попадают в атрибуты.
 */
export function inlineCssVars(markup: string, read: (name: string) => string): string {
  return markup.replace(CSS_VAR, (whole, name: string, fallback?: string) => {
    const value = read(name).trim() || fallback?.trim();
    return value ? escapeXml(value) : whole;
  });
}

/**
 * Свет лампы за фигурой и «коврик» под ногами — как в рисовалке. SVG, а не
 * градиент холста: у холста переход к transparent идёт через чёрный и в светлой
 * теме даёт серый ореол, а здесь гаснет только прозрачность того же цвета.
 * Лампа — двумя слоями: --gr-glow рассчитан на экран рядом с интерфейсом, в
 * картинке одного слоя почти не видно.
 */
export function backdropSvg(L: Pick<PostcardLayout, "lamp" | "floor">): string {
  const glow = "stop-color:var(--gr-glow)";
  const lamp = `<circle cx="${L.lamp.x}" cy="${L.lamp.y}" r="${L.lamp.r}" fill="url(#pc-lamp)"/>`;
  return (
    `<defs><radialGradient id="pc-lamp"><stop offset="0" style="${glow}"/>` +
    `<stop offset="1" stop-opacity="0" style="${glow}"/></radialGradient></defs>` +
    lamp +
    lamp +
    `<ellipse cx="${L.floor.x}" cy="${L.floor.y}" rx="${L.floor.rx}" ry="${L.floor.ry}" stroke-width="2"` +
    ` style="fill:var(--gr-wash-2);stroke:var(--gr-line)"/>`
  );
}

/** Обёртка из вложенных SVG (уже сериализованных) в рамке открытки; currentColor — цвет `color`. */
export function wrapSvg(width: number, height: number, color: string, inner: readonly string[]): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"` +
    ` style="color:${escapeXml(color)}">${inner.join("")}</svg>`
  );
}

// ── Сборка в браузере ────────────────────────────────────────────────────────

/** Отрисованные на странице SVG: Румик с рисунком в нужной позе, знак и надпись логотипа. */
export type PostcardSources = { rumik: SVGSVGElement; mark: SVGSVGElement; word: SVGSVGElement };

/** Копия SVG в нужном месте открытки, без классов и атрибутов страницы (её же берут «Итоги вечера»). */
export function placed(svg: SVGSVGElement, box: Box): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  for (const attr of ["class", "style", "role", "aria-label", "aria-hidden", "focusable"]) clone.removeAttribute(attr);
  clone.setAttribute("x", String(box.x));
  clone.setAttribute("y", String(box.y));
  clone.setAttribute("width", String(box.w));
  clone.setAttribute("height", String(box.h));
  return new XMLSerializer().serializeToString(clone);
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("postcard: SVG не загрузился"));
    img.src = src;
  });
}

/**
 * Собрать открытку в PNG. `scope` — элемент, с которого читаются токены (обычно
 * окно открытки: тема и шрифты там те же, что у страницы).
 */
export async function renderPostcard(sources: PostcardSources, pose: RumikPose, scope: Element): Promise<Blob> {
  const style = getComputedStyle(scope);
  const read = (name: string) => style.getPropertyValue(name);
  const c = readPostcardColors(read);
  const L = postcardLayout(pose);

  const canvas = document.createElement("canvas");
  canvas.width = L.width;
  canvas.height = L.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("postcard: холст недоступен");

  ctx.fillStyle = c.canvas;
  ctx.fillRect(0, 0, L.width, L.height);

  // Лампа, коврик, логотип и Румик — одной SVG-картинкой поверх фона.
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

  // Текст: шрифты страницы — дождаться, пока нужные начертания загружены.
  const titleFont = (size: number) => `700 ${size}px ${c.fontBrand}`;
  const siteFont = `500 ${L.site.size}px ${c.fontBody}`;
  await Promise.all([
    document.fonts.load(titleFont(L.title.size), POSTCARD_TITLE.join(" ")),
    document.fonts.load(siteFont, POSTCARD_SITE),
  ]).catch(() => undefined); // нет шрифта — нарисуем запасным, открытка всё равно нужна

  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = c.ink;
  const widest = (size: number) => {
    ctx.font = titleFont(size);
    return Math.max(...POSTCARD_TITLE.map((line) => ctx.measureText(line).width));
  };
  const size = fitFontSize(widest, L.title.maxWidth, L.title.size, 64);
  ctx.font = titleFont(size);
  const step = (L.title.lineHeight * size) / L.title.size;
  POSTCARD_TITLE.forEach((line, i) => ctx.fillText(line, L.title.x, L.title.y + i * step));

  ctx.font = siteFont;
  ctx.fillStyle = c.ink2;
  ctx.fillText(POSTCARD_SITE, L.site.x, L.site.y);

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("postcard: PNG не собрался"))), "image/png"),
  );
}

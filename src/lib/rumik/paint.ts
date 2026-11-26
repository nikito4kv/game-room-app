// Движок рисовалки Румика (R2): чистая арифметика и холст, без React.
//
// Рисуют на «слое краски» — холсте в рамке VIEW, в PAINT_SCALE раз крупнее
// (572×480), прозрачном вне фигуры и там, где краски нет (там виден белый
// Румик). Это ровно то, что лежит в хранилище и что принимает
// <Rumik paint={…} />: там слой режется по частям тела и в других позах едет
// вместе с руками и ногами. Поэтому рисуют всегда стоящего Румика.
//
// Координаты «мировые», как в geometry.ts: середина фигуры — x = 100.

import {
  ARM,
  AXIS_X,
  BODY,
  HAND_R,
  LEG,
  PARTS,
  PLATE,
  POSES,
  STROKE,
  VIEW,
  handAt,
  type RumikPart,
  type Shoulder,
} from "./geometry";
import { History } from "./history";
import { BRUSH_DEFAULT, BRUSH_MAX, BRUSH_MIN, PAINT_BASE } from "./palette";
import { STAGE } from "./stage";
import { PAINT_SCALE } from "./storage";

/** Холст слоя краски: рамка VIEW × PAINT_SCALE = 572×480. */
export const PAINT_W = VIEW.w * PAINT_SCALE;
export const PAINT_H = VIEW.h * PAINT_SCALE;

export { STAGE };

export { BRUSH_DEFAULT, BRUSH_MAX, BRUSH_MIN };

/** Насколько цвет может отличаться, чтобы заливка по нему растеклась (сумма |ΔR|+|ΔG|+|ΔB|). */
export const FILL_TOLERANCE = 90;

export type Point = readonly [x: number, y: number];
export type Rgb = readonly [r: number, g: number, b: number];

// ── Формы частей ─────────────────────────────────────────────────────────────

/** Скруглённый прямоугольник; `at` — сдвиг и поворот (как transform у руки в SVG). */
export type RoundRectShape = {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  at?: Shoulder;
};
export type CircleShape = { kind: "circle"; cx: number; cy: number; r: number };
export type PartShape = RoundRectShape | CircleShape;

const rad = (deg: number) => (deg * Math.PI) / 180;

const armShape = (at: Shoulder): RoundRectShape => ({
  kind: "rect",
  x: -ARM.w / 2,
  y: ARM.top,
  w: ARM.w,
  h: ARM.h,
  r: ARM.r,
  at,
});

const handShape = (at: Shoulder): CircleShape => {
  const [cx, cy] = handAt(at);
  return { kind: "circle", cx, cy, r: HAND_R };
};

/** Части стоящего Румика (как силуэт в Rumik.tsx и клипы рисунка). */
export const PART_SHAPES: Readonly<Record<RumikPart, PartShape>> = {
  legL: { kind: "rect", x: LEG.left, y: LEG.y, w: LEG.w, h: LEG.h, r: LEG.r },
  legR: { kind: "rect", x: LEG.right, y: LEG.y, w: LEG.w, h: LEG.h, r: LEG.r },
  armL: armShape(POSES.stand.l),
  armR: armShape(POSES.stand.r),
  body: { kind: "rect", x: BODY.x, y: BODY.y, w: BODY.w, h: BODY.h, r: BODY.r },
  handL: handShape(POSES.stand.l),
  handR: handShape(POSES.stand.r),
};

/** Тёмная плашка лица: лежит поверх краски, пипетка её не берёт. */
export const PLATE_SHAPE: RoundRectShape = { kind: "rect", x: PLATE.x, y: PLATE.y, w: PLATE.w, h: PLATE.h, r: PLATE.r };

/** Точка из мировых координат в систему прямоугольника (обратный поворот руки). */
function toLocal(s: RoundRectShape, x: number, y: number): Point {
  if (!s.at) return [x, y];
  const [tx, ty, angle] = s.at;
  const c = Math.cos(rad(angle));
  const sn = Math.sin(rad(angle));
  const dx = x - tx;
  const dy = y - ty;
  return [dx * c + dy * sn, -dx * sn + dy * c];
}

/** Из системы прямоугольника в мировые координаты. */
function toWorld(s: RoundRectShape, lx: number, ly: number): Point {
  if (!s.at) return [lx, ly];
  const [tx, ty, angle] = s.at;
  const c = Math.cos(rad(angle));
  const sn = Math.sin(rad(angle));
  return [tx + lx * c - ly * sn, ty + lx * sn + ly * c];
}

/** Лежит ли точка внутри формы (граница — внутри). */
export function pointInShape(s: PartShape, x: number, y: number): boolean {
  if (s.kind === "circle") return (x - s.cx) ** 2 + (y - s.cy) ** 2 <= s.r ** 2;
  const [lx, ly] = toLocal(s, x, y);
  const r = Math.min(s.r, s.w / 2, s.h / 2);
  const qx = Math.max(Math.abs(lx - (s.x + s.w / 2)) - (s.w / 2 - r), 0);
  const qy = Math.max(Math.abs(ly - (s.y + s.h / 2)) - (s.h / 2 - r), 0);
  return qx * qx + qy * qy <= r * r;
}

/** Рамка формы в мировых координатах: [x0, y0, x1, y1]. */
function shapeBounds(s: PartShape): [number, number, number, number] {
  if (s.kind === "circle") return [s.cx - s.r, s.cy - s.r, s.cx + s.r, s.cy + s.r];
  const corners = [
    toWorld(s, s.x, s.y),
    toWorld(s, s.x + s.w, s.y),
    toWorld(s, s.x + s.w, s.y + s.h),
    toWorld(s, s.x, s.y + s.h),
  ];
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * Какая часть видна в точке: индекс в PARTS (верхняя из перекрывающихся) или
 * −1 — мимо фигуры.
 */
export function partAt(x: number, y: number): number {
  for (let i = PARTS.length - 1; i >= 0; i--) if (pointInShape(PART_SHAPES[PARTS[i]], x, y)) return i;
  return -1;
}

/**
 * Маски частей одной картой: для каждого пикселя холста в рамке VIEW ×
 * `scale` — индекс видимой части (PARTS) или −1. Каждый пиксель принадлежит
 * ровно одной части: нижние части перекрываются верхними (руки — телом,
 * концы рук — кистями). Решает по центру пикселя.
 */
export function buildPartMap(scale: number = PAINT_SCALE): Int8Array {
  const w = Math.round(VIEW.w * scale);
  const h = Math.round(VIEW.h * scale);
  const out = new Int8Array(w * h).fill(-1);
  PARTS.forEach((part, i) => {
    const s = PART_SHAPES[part];
    const [x0, y0, x1, y1] = shapeBounds(s);
    const px0 = Math.max(0, Math.floor((x0 - VIEW.x) * scale));
    const py0 = Math.max(0, Math.floor((y0 - VIEW.y) * scale));
    const px1 = Math.min(w - 1, Math.ceil((x1 - VIEW.x) * scale));
    const py1 = Math.min(h - 1, Math.ceil((y1 - VIEW.y) * scale));
    for (let py = py0; py <= py1; py++) {
      const wy = VIEW.y + (py + 0.5) / scale;
      for (let px = px0; px <= px1; px++) {
        if (pointInShape(s, VIEW.x + (px + 0.5) / scale, wy)) out[py * w + px] = i;
      }
    }
  });
  return out;
}

// ── Координаты ───────────────────────────────────────────────────────────────

/** Отражение относительно оси фигуры (x = 100): для рисования с двух сторон. */
export function mirrorX(x: number): number {
  return 2 * AXIS_X - x;
}

export function mirrorPoint([x, y]: Point): Point {
  return [mirrorX(x), y];
}

/** Мировая точка → пиксель холста краски (целые, могут выйти за холст). */
export function toPixel(x: number, y: number, scale: number = PAINT_SCALE): [number, number] {
  return [Math.floor((x - VIEW.x) * scale), Math.floor((y - VIEW.y) * scale)];
}

/** Доли рамки STAGE (0…1 от левого верхнего угла) → мировая точка. */
export function stageToWorld(fx: number, fy: number): Point {
  return [STAGE.x + fx * STAGE.w, STAGE.y + fy * STAGE.h];
}

// ── Цвет ─────────────────────────────────────────────────────────────────────

/** «#89C3FE», «89c3fe», «#abc» → «#89c3fe»; не цвет — null. */
export function parseHex(input: string): string | null {
  const v = input.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{6}$/.test(v)) return `#${v}`;
  if (/^[0-9a-f]{3}$/.test(v)) return `#${v[0]}${v[0]}${v[1]}${v[1]}${v[2]}${v[2]}`;
  return null;
}

export function hexToRgb(hex: string): Rgb {
  const v = parseHex(hex) ?? PAINT_BASE;
  return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

const BASE_RGB = hexToRgb(PAINT_BASE);

/** Что видно в пикселе: краска поверх белого Румика (с учётом прозрачности). */
function visibleAt(data: Uint8ClampedArray, i: number, base: Rgb): Rgb {
  const a = data[i + 3] / 255;
  return [
    data[i] * a + base[0] * (1 - a),
    data[i + 1] * a + base[1] * (1 - a),
    data[i + 2] * a + base[2] * (1 - a),
  ];
}

const diff = (a: Rgb, b: Rgb) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

/** Пиксели холста: ImageData или такой же объект в тестах. */
export type PixelBuffer = { data: Uint8ClampedArray; width: number; height: number };

/** Ширина края заливки в пикселях холста: сглаженный край кисти — 1–2 px. */
const FILL_FRINGE = 2;

/**
 * Заливка: растекается по похожему цвету, но только внутри той части, на
 * которую нажали (на чистой части красит её целиком). `owner` — карта частей
 * того же размера (buildPartMap). Возвращает false, если красить нечего: мимо
 * фигуры или там уже этот цвет.
 *
 * Края штрихов сглажены: там краска полупрозрачная, и сквозь неё виден белый
 * Румик. По цвету такие пиксели в заливку не попадают, и после неё вдоль
 * штрихов оставались бы светлые «волоски». Поэтому полупрозрачные пиксели у
 * границы залитого (FILL_FRINGE) доливаются с учётом альфы:
 *   • залили чистое место — новый цвет подкладывается ПОД краску края
 *     (край красного штриха на красной заливке становится красным);
 *   • залили штрих — край того же цвета перекрашивается, прозрачность остаётся.
 */
export function floodFillPart(
  img: PixelBuffer,
  owner: Int8Array,
  px: number,
  py: number,
  color: Rgb,
  base: Rgb = BASE_RGB,
  tolerance: number = FILL_TOLERANCE,
): boolean {
  const { data, width: w, height: h } = img;
  if (px < 0 || py < 0 || px >= w || py >= h) return false;
  const start = py * w + px;
  const part = owner[start];
  if (part < 0) return false;
  const target = visibleAt(data, start * 4, base);
  if (data[start * 4 + 3] === 255 && diff(target, color) < 6) return false;
  // Чем был залитый участок: чистым Румиком (видна основа) или краской этого цвета.
  const startAlpha = data[start * 4 + 3];
  const startPaint: Rgb = [data[start * 4], data[start * 4 + 1], data[start * 4 + 2]];
  const onBase = diff(target, base) <= tolerance;

  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const filled = new Int32Array(w * h);
  let count = 0;
  let top = 0;
  stack[top++] = start;
  seen[start] = 1;
  while (top > 0) {
    const k = stack[--top];
    if (owner[k] !== part) continue;
    const i = k * 4;
    if (diff(visibleAt(data, i, base), target) > tolerance) continue;
    data[i] = color[0];
    data[i + 1] = color[1];
    data[i + 2] = color[2];
    data[i + 3] = 255;
    filled[count++] = k;
    const x = k % w;
    const next = [x + 1 < w ? k + 1 : -1, x > 0 ? k - 1 : -1, k + w < w * h ? k + w : -1, k - w];
    for (const n of next) {
      if (n >= 0 && !seen[n]) {
        seen[n] = 1;
        stack[top++] = n;
      }
    }
  }

  // Край: полупрозрачные пиксели той же части рядом с залитым. `seen` здесь
  // отмечает уже обработанные (залитые помечены ещё при обходе).
  for (let f = 0; f < count; f++) {
    const k = filled[f];
    const x = k % w;
    const y = (k - x) / w;
    for (let dy = -FILL_FRINGE; dy <= FILL_FRINGE; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -FILL_FRINGE; dx <= FILL_FRINGE; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= w) continue;
        const n = ny * w + nx;
        if (seen[n] === 2 || owner[n] !== part) continue;
        const i = n * 4;
        const a = data[i + 3];
        // Пусто (основа другого цвета) или краска плотная — это граница, не край.
        if (a === 0 || a === 255) continue;
        seen[n] = 2;
        const paint: Rgb = [data[i], data[i + 1], data[i + 2]];
        if (startAlpha > 0 && diff(paint, startPaint) <= tolerance) {
          // Край залитого штриха: тот же штрих новым цветом.
          data[i] = color[0];
          data[i + 1] = color[1];
          data[i + 2] = color[2];
        } else if (onBase) {
          // Край чужого штриха на залитом чистом месте: заливка под ним.
          const t = a / 255;
          data[i] = Math.round(paint[0] * t + color[0] * (1 - t));
          data[i + 1] = Math.round(paint[1] * t + color[1] * (1 - t));
          data[i + 2] = Math.round(paint[2] * t + color[2] * (1 - t));
          data[i + 3] = 255;
        }
      }
    }
  }
  return true;
}

/**
 * Пипетка: видимый цвет краски в пикселе (на некрашеном месте — белый Румик)
 * или null — мимо фигуры.
 */
export function pickPaintColor(img: PixelBuffer, owner: Int8Array, px: number, py: number, base: Rgb = BASE_RGB): string | null {
  if (px < 0 || py < 0 || px >= img.width || py >= img.height) return null;
  const k = py * img.width + px;
  if (owner[k] < 0) return null;
  return rgbToHex(visibleAt(img.data, k * 4, base));
}

/** Краски нет нигде: такой рисунок — просто белый Румик. */
export function isBlankPixels(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return false;
  return true;
}

// ── Файл PNG ─────────────────────────────────────────────────────────────────

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Ширина и высота из заголовка PNG (первые 24 байта) или null — это не PNG. */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) return null;
  if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== "IHDR") return null;
  const u32 = (o: number) => bytes[o] * 2 ** 24 + bytes[o + 1] * 2 ** 16 + bytes[o + 2] * 2 ** 8 + bytes[o + 3];
  return { width: u32(16), height: u32(20) };
}

/** Больше — точно не наш рисунок (наш PNG 572×480 весит десятки КБ). */
export const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

export type PaintUploadCheck = { ok: true; width: number; height: number } | { ok: false; error: string };

/** Одна понятная причина на все отказы: размеры и форматы человеку не нужны. */
export const UPLOAD_ERROR = "Это не рисунок Румика. Подойдёт файл из «Сохранить файл».";

/**
 * Можно ли загрузить файл как рисунок: PNG 572×480 (как сохраняет рисовалка)
 * или 286×240 (рисунок в обычном размере, растянется вдвое). `head` — хотя бы
 * первые 24 байта файла, `fileSize` — его полный размер.
 */
export function checkPaintUpload(head: Uint8Array, fileSize: number = head.length): PaintUploadCheck {
  if (fileSize > UPLOAD_MAX_BYTES) return { ok: false, error: UPLOAD_ERROR };
  const size = readPngSize(head);
  if (!size) return { ok: false, error: UPLOAD_ERROR };
  const { width, height } = size;
  const fits = (width === PAINT_W && height === PAINT_H) || (width === VIEW.w && height === VIEW.h);
  if (!fits) return { ok: false, error: UPLOAD_ERROR };
  return { ok: true, width, height };
}

/** Насколько может разойтись видимый цвет пикселя у «того же» рисунка (сумма |ΔR|+|ΔG|+|ΔB|). */
const SAME_TOLERANCE = 12;
/** Сколько пикселей могут разойтись сильнее: перекодирование PNG трогает единицы. */
const SAME_MISMATCHES = 16;

/**
 * Один ли это рисунок на вид. Строки PNG сравнивать нельзя: файл после
 * «Сохранить» и «Загрузить» перекодирован и отличается байтами. Сравниваем
 * видимый цвет (краска поверх белого Румика) с маленьким допуском.
 */
export function samePicture(a: PixelBuffer, b: PixelBuffer, base: Rgb = BASE_RGB): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  let mismatches = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    // Быстрый путь: пиксели совпали байт в байт.
    if (
      a.data[i] === b.data[i] &&
      a.data[i + 1] === b.data[i + 1] &&
      a.data[i + 2] === b.data[i + 2] &&
      a.data[i + 3] === b.data[i + 3]
    ) {
      continue;
    }
    if (diff(visibleAt(a.data, i, base), visibleAt(b.data, i, base)) <= SAME_TOLERANCE) continue;
    if (++mismatches > SAME_MISMATCHES) return false;
  }
  return true;
}

// ── Холст ────────────────────────────────────────────────────────────────────

/** Куда можно рисовать путь: и Path2D, и контекст холста. */
export type PathSink = Pick<CanvasPath, "moveTo" | "arcTo" | "arc" | "closePath">;

/**
 * Контур формы. Скругления — через arcTo, а не roundRect: ctx.roundRect и
 * Path2D.roundRect есть не во всех Firefox и Safari, а arcTo есть везде. Поворот
 * руки переносится на точки (окружность при повороте остаётся окружностью),
 * поэтому DOMMatrix и addPath с матрицей тоже не нужны. Все контуры обходятся
 * по часовой — объединение частей в одном пути не даёт «дыр».
 */
export function traceShape(sink: PathSink, s: PartShape): void {
  if (s.kind === "circle") {
    sink.moveTo(s.cx + s.r, s.cy);
    sink.arc(s.cx, s.cy, s.r, 0, Math.PI * 2);
    sink.closePath();
    return;
  }
  const { x, y, w, h } = s;
  const r = Math.min(s.r, w / 2, h / 2);
  const p = (lx: number, ly: number) => toWorld(s, lx, ly);
  const arc = (a: Point, b: Point) => sink.arcTo(a[0], a[1], b[0], b[1], r);
  const start = p(x + r, y);
  sink.moveTo(start[0], start[1]);
  arc(p(x + w, y), p(x + w, y + h));
  arc(p(x + w, y + h), p(x, y + h));
  arc(p(x, y + h), p(x, y));
  arc(p(x, y), p(x + w, y));
  sink.closePath();
}

function shapePath(s: PartShape): Path2D {
  const path = new Path2D();
  traceShape(path, s);
  return path;
}

/** Контуры частей в порядке PARTS (для клипа и обводки). */
export function partPaths(): Path2D[] {
  return PARTS.map((part) => shapePath(PART_SHAPES[part]));
}

/** Вся фигура одним путём: клип для кисти и загруженной картинки. */
export function figurePath(): Path2D {
  const path = new Path2D();
  for (const part of PARTS) traceShape(path, PART_SHAPES[part]);
  return path;
}

/** Мировые координаты на холсте краски. */
function setWorld(ctx: CanvasRenderingContext2D): void {
  ctx.setTransform(PAINT_SCALE, 0, 0, PAINT_SCALE, -VIEW.x * PAINT_SCALE, -VIEW.y * PAINT_SCALE);
}

/** Кисть: размер в мировых единицах и цвет; color: null — ластик. */
export type Brush = { size: number; color: string | null };

/** Отрезок кисти или ластика (from = to — точка), только по фигуре; mirror — ещё и отражённый. */
export function paintSegment(
  ctx: CanvasRenderingContext2D,
  figure: Path2D,
  from: Point,
  to: Point,
  brush: Brush,
  mirror: boolean,
): void {
  ctx.save();
  setWorld(ctx);
  ctx.clip(figure);
  ctx.globalCompositeOperation = brush.color ? "source-over" : "destination-out";
  // Ластику цвет не важен: destination-out стирает по форме мазка.
  const color = brush.color ?? PAINT_BASE;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = brush.size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const seg = (a: Point, b: Point) => {
    ctx.beginPath();
    if (a[0] === b[0] && a[1] === b[1]) {
      // Точка: отрезок нулевой длины с круглыми концами рисуют не все браузеры.
      ctx.arc(a[0], a[1], brush.size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
  };
  seg(from, to);
  if (mirror) seg(mirrorPoint(from), mirrorPoint(to));
  ctx.restore();
}

/** Цвета фигуры на экране: из токенов (--gr-rumik-white, --gr-avatar-ink), их читает компонент. */
export type FigureInk = { base: string; ink: string };

/**
 * Картинка в рисовалке: по частям снизу вверх — белая основа, краска, обводка.
 * Верхние части закрывают обводку нижних, как у SVG-Румика. Рамка — STAGE на
 * весь холст `view`. Лицо (плашка и глаза) — поверх, отдельным слоем.
 */
export function composeFigure(
  view: CanvasRenderingContext2D,
  paint: CanvasImageSource,
  paths: readonly Path2D[],
  ink: FigureInk,
): void {
  const { width, height } = view.canvas;
  const k = width / STAGE.w;
  view.setTransform(1, 0, 0, 1, 0, 0);
  view.clearRect(0, 0, width, height);
  view.setTransform(k, 0, 0, k, -STAGE.x * k, -STAGE.y * k);
  view.imageSmoothingEnabled = true;
  view.imageSmoothingQuality = "high";
  view.fillStyle = ink.base;
  view.strokeStyle = ink.ink;
  view.lineWidth = STROKE;
  view.lineJoin = "round";
  for (const path of paths) {
    view.save();
    view.clip(path);
    view.fill(path);
    view.drawImage(paint, VIEW.x, VIEW.y, VIEW.w, VIEW.h);
    view.restore();
    view.stroke(path);
  }
}

/** Картинка из data URL или файла, готовая к drawImage. */
export async function decodeImage(src: string | Blob): Promise<CanvasImageSource> {
  if (typeof src !== "string" && typeof createImageBitmap === "function") return createImageBitmap(src);
  const url = typeof src === "string" ? src : URL.createObjectURL(src);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    if (typeof src !== "string") URL.revokeObjectURL(url);
  }
}

/**
 * Шаг истории: как было до действия. swap — действие сменило рисунок целиком
 * («стереть всё», файл, «Мои Румики»): его отмена тоже смена рисунка, и
 * хранилище кладёт прежний в «Мои Румики» (saveMyPaint), а не просто
 * перезаписывает текущий (updateMyPaint).
 */
type Step = { img: ImageData; swap: boolean };

/** Что сделала отмена или возврат: дорисовка или смена рисунка. */
export type StepKind = "edit" | "swap";

/**
 * Слой краски со своей историей. Держит холст 572×480 (willReadFrequently:
 * снимки истории, заливка и пипетка читают пиксели) и умеет всё, что делают
 * инструменты. Рисует в мировых координатах.
 */
export class PaintEngine {
  readonly canvas: HTMLCanvasElement;
  readonly paths: Path2D[];
  private readonly ctx: CanvasRenderingContext2D;
  private readonly figure: Path2D;
  private readonly history = new History<Step>();
  private owner: Int8Array | null = null;
  private last: Point | null = null;
  private brush: Brush = { size: BRUSH_DEFAULT, color: null };
  private mirror = false;

  constructor(private readonly doc: Document = document) {
    this.canvas = doc.createElement("canvas");
    this.canvas.width = PAINT_W;
    this.canvas.height = PAINT_H;
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Холст недоступен");
    this.ctx = ctx;
    this.paths = partPaths();
    this.figure = figurePath();
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  /** Идёт штрих. */
  get drawing(): boolean {
    return this.last !== null;
  }

  private pixels(): ImageData {
    return this.ctx.getImageData(0, 0, PAINT_W, PAINT_H);
  }

  private put(img: ImageData): void {
    this.ctx.putImageData(img, 0, 0);
  }

  /** Карта частей считается один раз, при первой заливке или пипетке. */
  private partMap(): Int8Array {
    return (this.owner ??= buildPartMap());
  }

  /** Начать штрих кистью или ластиком. */
  begin(p: Point, brush: Brush, mirror: boolean): void {
    this.history.record({ img: this.pixels(), swap: false });
    this.brush = brush;
    this.mirror = mirror;
    this.last = p;
    paintSegment(this.ctx, this.figure, p, p, brush, mirror);
  }

  /** Продолжить штрих до точки. */
  move(p: Point): void {
    if (!this.last) return;
    paintSegment(this.ctx, this.figure, this.last, p, this.brush, this.mirror);
    this.last = p;
  }

  /** Закончить штрих; true — он был. */
  end(): boolean {
    const was = this.last !== null;
    this.last = null;
    return was;
  }

  /** Заливка части под точкой. */
  fill(p: Point, hex: string): boolean {
    const [px, py] = toPixel(p[0], p[1]);
    const img = this.pixels();
    const before = new ImageData(new Uint8ClampedArray(img.data), PAINT_W, PAINT_H);
    if (!floodFillPart(img, this.partMap(), px, py, hexToRgb(hex))) return false;
    this.history.record({ img: before, swap: false });
    this.put(img);
    return true;
  }

  /** Пипетка: цвет под точкой или null (мимо фигуры, по лицу). */
  pick(p: Point): string | null {
    if (pointInShape(PLATE_SHAPE, p[0], p[1])) return null;
    const [px, py] = toPixel(p[0], p[1]);
    if (px < 0 || py < 0 || px >= PAINT_W || py >= PAINT_H) return null;
    const owner = this.partMap();
    if (owner[py * PAINT_W + px] < 0) return null;
    const one = this.ctx.getImageData(px, py, 1, 1);
    return pickPaintColor(one, new Int8Array([owner[py * PAINT_W + px]]), 0, 0);
  }

  /** Стереть всё (можно вернуть «назад»); false — и так чисто. */
  clear(): boolean {
    if (this.isBlank()) return false;
    this.history.record({ img: this.pixels(), swap: true });
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, PAINT_W, PAINT_H);
    return true;
  }

  /** Шаг назад; null — некуда (или идёт штрих). */
  undo(): StepKind | null {
    const step = this.history.peekUndo();
    if (this.last || !step) return null;
    this.history.undo({ img: this.pixels(), swap: step.swap });
    this.put(step.img);
    return step.swap ? "swap" : "edit";
  }

  /** Шаг вперёд после отмены; null — некуда. */
  redo(): StepKind | null {
    const step = this.history.peekRedo();
    if (this.last || !step) return null;
    this.history.redo({ img: this.pixels(), swap: step.swap });
    this.put(step.img);
    return step.swap ? "swap" : "edit";
  }

  isBlank(): boolean {
    return isBlankPixels(this.pixels().data);
  }

  /**
   * Поставить другой рисунок (из хранилища, файла, «Моих Румиков»); null —
   * белый Румик. Картинка растягивается на холст и режется по фигуре.
   * record — шаг можно отменить (это смена рисунка).
   */
  replace(img: CanvasImageSource | null, record: boolean): void {
    if (record) this.history.record({ img: this.pixels(), swap: true });
    this.last = null;
    this.drawInto(this.ctx, img);
  }

  /** Картинка на холсте так, как её кладёт replace: растянута и обрезана по фигуре. */
  private drawInto(ctx: CanvasRenderingContext2D, img: CanvasImageSource | null): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, PAINT_W, PAINT_H);
    if (!img) return;
    ctx.save();
    setWorld(ctx);
    ctx.clip(this.figure);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, PAINT_W, PAINT_H);
    ctx.restore();
  }

  /**
   * Пиксели картинки, положенной так же, как replace, — не трогая рисунок и
   * историю. Нужны, чтобы сравнить рисунки (samePicture): загруженный файл с
   * тем, что уже лежит в «Моих Румиках».
   */
  pixelsOf(img: CanvasImageSource | null): ImageData {
    const scratch = this.doc.createElement("canvas");
    scratch.width = PAINT_W;
    scratch.height = PAINT_H;
    const ctx = scratch.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Холст недоступен");
    this.drawInto(ctx, img);
    return ctx.getImageData(0, 0, PAINT_W, PAINT_H);
  }

  /** Пиксели рисунка сейчас. */
  imageData(): ImageData {
    return this.pixels();
  }

  /** Забыть историю (рисунок сменили в другой вкладке). */
  resetHistory(): void {
    this.history.clear();
  }

  /** PNG data URL для хранилища или null — краски нет (белый Румик). */
  toDataUrl(): string | null {
    return this.isBlank() ? null : this.canvas.toDataURL("image/png");
  }

  /** PNG-файл слоя краски 572×480. */
  toBlob(): Promise<Blob | null> {
    return new Promise((resolve) => this.canvas.toBlob(resolve, "image/png"));
  }
}

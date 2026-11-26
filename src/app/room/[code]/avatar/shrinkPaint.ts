// Свой рисунок для сервера: в браузере он лежит вдвое крупнее (572×480, см.
// src/lib/rumik/storage.ts), другим уходит в обычном размере — 286×240 PNG.
import { AVATAR_HEIGHT, AVATAR_MAX_BYTES, AVATAR_WIDTH } from "@/lib/api/contract";

const PREFIX = "data:image/png;base64,";

/**
 * Сколько ступеней на канал оставлять, если рисунок не влез в AVATAR_MAX_BYTES:
 * по очереди, пока не влезет. Замер на рисовалке: кисть влезает как есть (5–20 КБ),
 * фото после 16 ступеней весит 16–30 КБ, после 8 — 12–26 КБ, после 4 — 7–17 КБ.
 * Шум не влезает и в 4 ступени — другие увидят Румика без рисунка.
 */
const LEVELS = [16, 8, 4] as const;

/** Сколько байт в base64-строке. */
function base64Bytes(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return (b64.length * 3) / 4 - pad;
}

function encode(canvas: HTMLCanvasElement): string {
  const url = canvas.toDataURL("image/png");
  return url.startsWith(PREFIX) ? url.slice(PREFIX.length) : "";
}

/** Огрубить цвета исходника до levels ступеней на канал: плоские пятна сжимаются лучше. */
function posterize(ctx: CanvasRenderingContext2D, source: ImageData, levels: number): void {
  const img = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
  const d = img.data;
  const step = 255 / (levels - 1);
  for (let i = 0; i < d.length; i++) d[i] = Math.round(Math.round(d[i]! / step) * step);
  ctx.putImageData(img, 0, 0);
}

let last: { paint: string; png: string | null } | null = null;

/**
 * Рисунок (PNG data URL) → base64 PNG AVATAR_WIDTH×AVATAR_HEIGHT без «data:…».
 * null — не влез в AVATAR_MAX_BYTES даже огрублённым (тогда другие видят
 * Румика своего цвета без рисунка). Последний результат помним: повторная
 * отправка того же не пережимает.
 */
export async function shrinkPaint(paint: string): Promise<string | null> {
  if (last?.paint === paint) return last.png;
  const img = new Image();
  img.src = paint;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_WIDTH;
  canvas.height = AVATAR_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d недоступен");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, AVATAR_WIDTH, AVATAR_HEIGHT);
  let png = encode(canvas);
  if (base64Bytes(png) > AVATAR_MAX_BYTES) {
    const source = ctx.getImageData(0, 0, AVATAR_WIDTH, AVATAR_HEIGHT);
    for (const levels of LEVELS) {
      posterize(ctx, source, levels);
      png = encode(canvas);
      if (base64Bytes(png) <= AVATAR_MAX_BYTES) break;
    }
  }
  const fits = png !== "" && base64Bytes(png) <= AVATAR_MAX_BYTES;
  last = { paint, png: fits ? png : null };
  return last.png;
}

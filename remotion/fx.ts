import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

/** Кривые из дизайн-системы (tokens.css): --gr-ease-out и --gr-ease-in-out. */
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
export const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));

/** Плавный прогресс 0…1 между кадрами from…to по кривой ease-out. */
export const prog = (frame: number, from: number, to: number, easing = EASE_OUT) =>
  interpolate(frame, [from, to], [0, 1], {
    easing,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

/** Спокойная пружина без отскока: для появления текста и карточек. */
export function useSpring(delay = 0, opts?: { damping?: number; stiffness?: number; mass?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({
    frame: frame - delay,
    fps,
    config: { damping: opts?.damping ?? 200, stiffness: opts?.stiffness ?? 120, mass: opts?.mass ?? 1 },
  });
}

/** Лёгкий «живой» отскок для аватаров, которые садятся за стол. */
export function usePop(delay = 0) {
  return useSpring(delay, { damping: 16, stiffness: 140, mass: 0.9 });
}

/**
 * Громкость голоса 0…1 в кадре: сглаженная «речь» без случайности (рендер
 * детерминирован). seed разводит разных людей по фазе.
 */
export function voiceLevel(frame: number, seed: number) {
  const a = Math.sin(frame * 0.37 + seed * 3.1);
  const b = Math.sin(frame * 0.91 + seed * 1.7);
  const c = Math.sin(frame * 0.13 + seed);
  return clamp(0.58 + 0.24 * a * b + 0.2 * c, 0.15, 1);
}

/** Детерминированный «шум» 0…1 по номеру элемента. */
export function hash01(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Размер композиции и признак формата. */
export function useFormat() {
  const { width, height } = useVideoConfig();
  const tall = height > width * 1.2;
  const square = !tall && Math.abs(width - height) < 80;
  return { width, height, tall, square, wide: !tall && !square };
}

/**
 * Безопасные зоны вертикальных площадок (Reels, Shorts, TikTok, Telegram):
 * сверху ~250 px занимает интерфейс площадки, снизу ~340 px — подпись и кнопки.
 * Ключевой текст держим внутри.
 */
export const SAFE_TALL = { top: 260, bottom: 350, side: 72 };

const NBSP = " ";
const SHORT = /^[A-Za-zА-Яа-яЁё]{1,3}$/;

export type Word = { text: string; accent: boolean; breakAfter: boolean };

/**
 * Разбор строки из copy.ts: *акцент*, | — перенос строки. Короткие слова
 * («в», «с», «и», «для»…) клеятся к следующему неразрывным пробелом, как
 * glueShortWords в продукте: предлог не повиснет в конце строки.
 */
export function parseRich(text: string): Word[] {
  const out: Word[] = [];
  const lines = text.split("|");
  let accent = false;
  lines.forEach((line, li) => {
    const raw: { text: string; accent: boolean }[] = [];
    line.split("*").forEach((part, pi) => {
      if (pi > 0) accent = !accent;
      part
        .split(" ")
        .filter(Boolean)
        .forEach((w) => raw.push({ text: w, accent }));
    });
    accent = false;
    const merged: { text: string; accent: boolean }[] = [];
    let carry = "";
    raw.forEach((w, i) => {
      const joined = carry + w.text;
      carry = "";
      if (SHORT.test(joined) && i < raw.length - 1) carry = joined + NBSP;
      else merged.push({ text: joined, accent: w.accent });
    });
    merged.forEach((w, wi) => out.push({ ...w, breakAfter: li < lines.length - 1 && wi === merged.length - 1 }));
  });
  return out;
}

/** Склеить короткие слова в обычной строке (подзаголовки, подписи). | считается пробелом. */
export function glue(text: string) {
  return text.replace(/\|/g, " ").replace(/(^| )([A-Za-zА-Яа-яЁё]{1,3}) /g, "$1$2" + NBSP);
}

/** Та же строка без разметки. */
export const plain = (text: string) => text.replace(/\*/g, "").replace(/\|/g, " ");

/** Окно 0…1: плавно включается к кадру a и выключается к кадру b (f — длина фронта). */
export const win = (frame: number, a: number, b: number, f = 6) =>
  Math.min(prog(frame, a, a + f), 1 - prog(frame, b - f, b));

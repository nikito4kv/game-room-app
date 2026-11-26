// Потолок качества показа экрана от администрации (А3, limits.maxScreenQuality).
// Профиль выше потолка в настройках недоступен, а если он уже выбран — показ
// идёт с лучшим разрешённым профилем. Сам выбор человека не стираем: снимут
// потолок — вернётся его профиль.
import type { ScreenQualityCap } from "@/lib/api/platform";
import { SCREEN_PRESETS, type ScreenQuality } from "@/lib/screenShare";

const CAP_HEIGHT: Record<ScreenQualityCap, number> = { "720p": 720, "1080p": 1080, "1440p": 1440 };

/** Профили для запасного выбора — от лучшего к худшему (Текст не замена игровому). */
const FALLBACK_ORDER: readonly ScreenQuality[] = ["max", "smooth", "light"];

export function isScreenQualityCap(x: unknown): x is ScreenQualityCap {
  return x === "720p" || x === "1080p" || x === "1440p";
}

/** Разрешён ли профиль при потолке (по высоте кадра профиля). */
export function isQualityAllowed(q: ScreenQuality, cap: ScreenQualityCap): boolean {
  return SCREEN_PRESETS[q].height <= CAP_HEIGHT[cap];
}

/** С каким профилем показывать: выбранный, если разрешён, иначе лучший разрешённый. */
export function clampScreenQuality(q: ScreenQuality, cap: ScreenQualityCap): ScreenQuality {
  if (isQualityAllowed(q, cap)) return q;
  return FALLBACK_ORDER.find((f) => isQualityAllowed(f, cap)) ?? "light";
}

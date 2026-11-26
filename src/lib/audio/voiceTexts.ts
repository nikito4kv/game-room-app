// Тексты окна настроек про голос: статус шумодава, итог калибровки, подписи
// чувствительности. Чистые функции — их легко проверить и поправить в одном месте.
import { formatDb } from "@/components/ui/level";
import type { MicStatus } from "./micProcessor";
import type { CalibrationResult } from "./worklet/protocol";

export type StatusText = { text: string; tone: "normal" | "caution" };

/**
 * Честный статус шумодава под переключателем. Наш не работает — говорим, что
 * вместо него включён встроенный в браузер (он слабее, но лучше, чем ничего).
 */
export function noiseSuppressionText(opts: {
  enabled: boolean;
  status: MicStatus;
  waitingForGesture: boolean;
}): StatusText {
  if (!opts.enabled) return { text: "Выключено: в эфир идёт всё, что слышит микрофон", tone: "normal" };
  if (opts.waitingForGesture) {
    return {
      text: "Включится после первого клика на странице. Пока работает встроенный в браузер",
      tone: "caution",
    };
  }
  const { state, reason } = opts.status;
  if (state === "loading") return { text: "Загружается…", tone: "normal" };
  if (state === "error") {
    const why =
      reason === "worklet"
        ? "Обработка звука не запустилась"
        : reason === "sample-rate"
          ? "Браузер не дал нужную частоту звука"
          : "Шумодав не загрузился";
    return { text: `${why} — работает встроенный в браузер, он слабее`, tone: "caution" };
  }
  return { text: "Убирает гул кулеров, клавиатуру и фон", tone: "normal" };
}

/** Итог калибровки одной фразой. */
export function calibrationText(r: CalibrationResult): StatusText {
  if (r.ok) {
    return { text: `Готово: ваш голос ${formatDb(r.voiceDb)}, порог ${formatDb(r.thresholdDb)}`, tone: "normal" };
  }
  switch (r.reason) {
    case "no-speech":
      return { text: "Не услышали речь. Нажмите ещё раз и говорите все 3 секунды", tone: "caution" };
    case "too-quiet":
      return {
        text: "Микрофон слышит вас еле-еле. Прибавьте громкость микрофона или поднесите его ближе ко рту",
        tone: "caution",
      };
    case "noisy":
      return {
        text: "Голос почти не громче шума вокруг. Поднесите микрофон ближе ко рту и попробуйте снова",
        tone: "caution",
      };
    default:
      return { text: "Обработка звука не запущена — калибровка сейчас недоступна", tone: "caution" };
  }
}

/** Поправка авто-порога: «0», «+3 дБ» (чувствительнее), «−5 дБ» (строже). */
export function sensitivityText(v: number): string {
  const r = Math.round(v);
  return r > 0 ? `+${formatDb(r)}` : r < 0 ? formatDb(r) : "0";
}

// Связь с сервером для шапки комнаты и своего места: пинг и качество.

import type { ConnectionQuality } from "@/components/ui/SignalBars";

/** Одна запись статистики WebRTC — только нужные поля. */
type StatsEntry = { type?: string; nominated?: boolean; currentRoundTripTime?: number };

/**
 * RTT (мс) выбранной ICE-пары из RTCPeerConnection.getStats(). Берётся последняя
 * подходящая пара; нет данных → null (тогда остаётся качество от LiveKit).
 */
export function rttFromStats(stats: {
  forEach(cb: (entry: StatsEntry) => void): void;
}): number | null {
  let ms: number | null = null;
  stats.forEach((r) => {
    if (
      r.type === "candidate-pair" &&
      r.nominated &&
      typeof r.currentRoundTripTime === "number"
    ) {
      ms = Math.round(r.currentRoundTripTime * 1000);
    }
  });
  return ms;
}

/** Качество по пингу: до 60 мс — отличная, до 150 — хорошая, дальше — слабая. */
export function rttQuality(rttMs: number): ConnectionQuality {
  if (rttMs < 60) return "excellent";
  if (rttMs < 150) return "good";
  return "poor";
}

const RANK: Record<ConnectionQuality, number> = { excellent: 4, good: 3, poor: 2, lost: 1, unknown: 0 };

/**
 * Итоговое качество: худшее из «по пингу» и оценки LiveKit (она видит потери и
 * джиттер, которых пинг не покажет). Пока ничего не известно — unknown.
 */
export function linkQuality(rttMs: number | null, livekit: ConnectionQuality): ConnectionQuality {
  if (rttMs === null) return livekit;
  const byRtt = rttQuality(rttMs);
  if (livekit === "unknown") return byRtt;
  return RANK[livekit] < RANK[byRtt] ? livekit : byRtt;
}

/** Слабая связь или её нет — повод показать значок на месте участника. */
export function isPoorLink(q: ConnectionQuality): boolean {
  return q === "poor" || q === "lost";
}

const QUALITY_TEXT: Record<ConnectionQuality, string> = {
  excellent: "отличная",
  good: "хорошая",
  poor: "слабая",
  lost: "нет связи",
  unknown: "проверяем",
};

/** «Связь с сервером: отличная, 42 мс» — подсказка у значка связи. */
export function linkHint(q: ConnectionQuality, rttMs: number | null): string {
  if (q === "lost") return "Связь с сервером потеряна";
  return `Связь с сервером: ${QUALITY_TEXT[q]}${rttMs !== null ? `, ${rttMs} мс` : ""}`;
}

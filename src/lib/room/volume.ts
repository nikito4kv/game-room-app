// Громкость входящих дорожек «для себя». Персональные настройки — карты
// «identity → значение» из localStorage, поэтому значения могут быть мусором.

/** Персональные громкости, как их отдаёт useVolumes() комнаты. */
export type VolumeMaps = {
  /** Общая громкость приёма, 0..1. */
  master: number;
  /** Голос участника, 0..2 (1 = 100%). */
  voice: Record<string, number>;
  /** Звук демонстрации участника, 0..2. Не задан → как его голос. */
  stream: Record<string, number>;
  /** «Заглушить для себя». */
  mutes: Record<string, boolean>;
};

/** Что за дорожка: голос (микрофон) или звук демонстрации экрана. */
export type IncomingAudioKind = "voice" | "stream";

/**
 * Громкость воспроизведения одной входящей дорожки: master × персональная.
 * Для звука демонстрации персональная = stream[id], а если не задана — голос
 * участника. «Заглушить для себя» → 0 (громкостью, а не muted: подписка жива,
 * индикатор «говорит» работает). Больше 1 — буст через webAudioMix. Мусор
 * (NaN, бесконечность) → 1, отрицательное → 0.
 */
export function trackVolume(v: VolumeMaps, identity: string, kind: IncomingAudioKind): number {
  const personal =
    kind === "stream" ? (v.stream[identity] ?? v.voice[identity] ?? 1) : (v.voice[identity] ?? 1);
  const raw = v.master * personal;
  return v.mutes[identity] ? 0 : Number.isFinite(raw) ? Math.max(0, raw) : 1;
}

/** Проверка карты громкостей из localStorage: объект «строка → число». */
export function isVolumeMap(v: unknown): v is Record<string, number> {
  return (
    !!v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.values(v).every((x) => typeof x === "number")
  );
}

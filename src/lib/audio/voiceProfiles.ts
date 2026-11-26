// Профиль голоса по микрофону: уровни своего голоса и фона, на которые авто-порог
// опирается с первой секунды. Без профиля порог учится заново на каждом входе, и
// первые секунды сосед может проходить в эфир (замеры dsp: 44 % кадров соседа в
// первые 6 с, с профилем — как после первой фразы). Профиль свой у каждого
// микрофона: у гарнитуры и у веб-камеры уровни разные.
import { readLocalJSON, writeLocalJSON } from "@/lib/clientStorage";

const KEY = "gr.audio.voiceProfiles";
/** Сколько микрофонов помним — старые вытесняются. */
const MAX_PROFILES = 8;

export type VoiceProfile = {
  /** Уровень своего голоса, дБFS. */
  voiceDb: number;
  /** Уровень фона, дБFS; null — ещё не знаем. */
  noiseDb: number | null;
  /** Когда сохранён (мс) — для вытеснения старых. */
  savedAt: number;
};

export type VoiceProfiles = Record<string, VoiceProfile>;

/**
 * Ключ профиля для захваченной дорожки. groupId — физическое устройство (у записи
 * «по умолчанию» он тот же, что у настоящего микрофона за ней), поэтому профиль
 * не теряется, когда человек переключается между «Как в системе» и тем же
 * микрофоном по имени. Нет groupId — deviceId.
 */
export function profileKey(settings: { deviceId?: string; groupId?: string }): string | null {
  return settings.groupId || settings.deviceId || null;
}

/** Правдоподобные уровни: голос в разумных пределах и громче фона. */
export function plausibleProfile(voiceDb: number, noiseDb: number): boolean {
  if (!Number.isFinite(voiceDb) || voiceDb < -70 || voiceDb > 0) return false;
  if (Number.isFinite(noiseDb) && (noiseDb > voiceDb || noiseDb < -120)) return false;
  return true;
}

function isProfile(v: unknown): v is VoiceProfile {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.voiceDb === "number" &&
    (p.noiseDb === null || typeof p.noiseDb === "number") &&
    typeof p.savedAt === "number"
  );
}

export function isVoiceProfiles(v: unknown): v is VoiceProfiles {
  return !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every(isProfile);
}

/** Добавить/обновить профиль; в карте остаются max самых свежих. */
export function upsertProfile(
  map: VoiceProfiles,
  key: string,
  profile: VoiceProfile,
  max = MAX_PROFILES,
): VoiceProfiles {
  const entries = Object.entries({ ...map, [key]: profile })
    .sort(([, a], [, b]) => b.savedAt - a.savedAt)
    .slice(0, max);
  return Object.fromEntries(entries);
}

export function loadVoiceProfile(key: string): VoiceProfile | null {
  const p = readLocalJSON<VoiceProfiles>(KEY, {}, isVoiceProfiles)[key];
  return p && plausibleProfile(p.voiceDb, p.noiseDb ?? NaN) ? p : null;
}

/** Сохранить уровни, если они правдоподобны. Возвращает, сохранилось ли. */
export function saveVoiceProfile(key: string, voiceDb: number, noiseDb: number, now = Date.now()): boolean {
  if (!plausibleProfile(voiceDb, noiseDb)) return false;
  const map = readLocalJSON<VoiceProfiles>(KEY, {}, isVoiceProfiles);
  const profile: VoiceProfile = {
    voiceDb: Math.round(voiceDb * 10) / 10,
    noiseDb: Number.isFinite(noiseDb) ? Math.round(noiseDb * 10) / 10 : null,
    savedAt: now,
  };
  writeLocalJSON(KEY, upsertProfile(map, key, profile));
  return true;
}

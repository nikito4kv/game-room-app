// Настройки звука «для себя», которые переживают перезагрузку: обработка голоса,
// захват, устройства, задержка рации. Общий доступ — через usePersistentState
// (окно настроек, MicProvider, RoomAudio видят одно и то же значение).
//
// Старые ключи (gr.audio.inputGain, gr.audio.noiseSuppression, устройства)
// читаем и пишем как раньше — лобби и прошлые сохранения работают без
// переезда. Новое — в своих ключах рядом.
import {
  getInputDevice,
  getInputGain,
  getNoiseSuppression,
  getOutputDevice,
  readLocal,
  readLocalJSON,
  setInputDevice,
  setInputGain,
  setNoiseSuppression,
  setOutputDevice,
  writeLocal,
  writeLocalJSON,
} from "@/lib/clientStorage";
import { DEFAULT_DEVICE } from "@/lib/audio/devices";
import {
  DEFAULT_CAPTURE_SETTINGS,
  sanitizeCaptureSettings,
  type CaptureSettings,
} from "@/lib/audio/voiceOptions";
import { DEFAULT_VOICE_SETTINGS, sanitizeVoiceSettings, type VoiceSettings } from "@/lib/audio/worklet/protocol";
import { persistentKey } from "../state/usePersistentState";

/** Режим порога, ручной порог, чувствительность и своя автогромкость. */
const VOICE_KEY = "gr.audio.voice";
/** Эхоподавление и автогромкость браузера. */
const CAPTURE_KEY = "gr.audio.capture";
/** Задержка отпускания рации, мс. */
const PTT_RELEASE_KEY = "gr.keys.pttReleaseMs";

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Настройки обработки голоса (MicProcessor). Значения из хранилища приводятся к
 * допустимым: «5» в усилении не превратится в 500 % (аудит 1-audio, 3.18).
 */
export const voiceSettingsPref = persistentKey<VoiceSettings>({
  read: () =>
    sanitizeVoiceSettings({
      ...readLocalJSON<Partial<VoiceSettings>>(VOICE_KEY, {}, isObject),
      gain: getInputGain(),
      noiseSuppression: getNoiseSuppression(),
    }),
  write: (s) => {
    writeLocalJSON(VOICE_KEY, {
      gateMode: s.gateMode,
      manualThresholdDb: s.manualThresholdDb,
      manualUseVad: s.manualUseVad,
      sensitivityDb: s.sensitivityDb,
      autoGain: s.autoGain,
    });
    setInputGain(s.gain);
    setNoiseSuppression(s.noiseSuppression);
  },
  initial: DEFAULT_VOICE_SETTINGS,
});

/** Обработка захвата: эхоподавление (вкл) и автогромкость браузера (выкл). */
export const captureSettingsPref = persistentKey<CaptureSettings>({
  read: () => sanitizeCaptureSettings(readLocalJSON(CAPTURE_KEY, {}, isObject)),
  write: (c) => writeLocalJSON(CAPTURE_KEY, c),
  initial: DEFAULT_CAPTURE_SETTINGS,
});

/** Выбранный микрофон: «default» — как в системе. */
export const inputDevicePref = persistentKey<string>({
  read: () => getInputDevice() || DEFAULT_DEVICE,
  write: setInputDevice,
  initial: DEFAULT_DEVICE,
});

/** Выбранное устройство вывода: «default» — как в системе. */
export const outputDevicePref = persistentKey<string>({
  read: () => getOutputDevice() || DEFAULT_DEVICE,
  write: setOutputDevice,
  initial: DEFAULT_DEVICE,
});

export const PTT_RELEASE_RANGE = { min: 0, max: 600, step: 10, initial: 200 } as const;

/**
 * Задержка отпускания рации: эфир закрывается чуть позже отпускания клавиши,
 * чтобы не съедать конец последнего слова (в Discord — «Push to Talk Release
 * Delay»).
 */
export const pttReleasePref = persistentKey<number>({
  read: () => {
    const raw = readLocal(PTT_RELEASE_KEY);
    const n = raw === null ? NaN : Number(raw);
    const ms = Number.isFinite(n) ? n : PTT_RELEASE_RANGE.initial;
    return Math.min(PTT_RELEASE_RANGE.max, Math.max(PTT_RELEASE_RANGE.min, Math.round(ms)));
  },
  write: (ms) => writeLocal(PTT_RELEASE_KEY, String(ms)),
  initial: PTT_RELEASE_RANGE.initial,
});

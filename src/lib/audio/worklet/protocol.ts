/**
 * Общий «язык» основного потока и worklet обработки голоса: настройки, метрики,
 * сообщения через port. Здесь только типы и константы — модуль импортируют и
 * страница, и worklet (он собирается отдельно, см. scripts/build-audio.mjs).
 */
import type { CalibrationResult } from "./dsp/calibration";

export type { CalibrationResult };

/** Имя процессора в registerProcessor / new AudioWorkletNode. */
export const VOICE_PROCESSOR_NAME = "voice-processor";

/** Частота, на которой работает RNNoise (и весь контекст микрофона). */
export const VOICE_SAMPLE_RATE = 48000;

/** Кадр обработки: 10 мс на 48 кГц — столько ест RNNoise за раз. */
export const VOICE_FRAME = 480;

/**
 * Режим порога:
 *  • auto — порог считается сам по вашему голосу и фону (по умолчанию);
 *  • manual — порог в дБ задан ползунком;
 *  • off — порог не режет звук (индикатор «я говорю» всё равно работает по авто-детектору).
 */
export type GateMode = "auto" | "manual" | "off";

export type VoiceSettings = {
  /** Шумодав RNNoise. Выключен — в эфир идёт сигнал без шумодава (порог работает). */
  noiseSuppression: boolean;
  gateMode: GateMode;
  /** Порог ручного режима, дБFS (−70…−10). */
  manualThresholdDb: number;
  /** В ручном режиме открывать порог только на речь (VAD), а не на любой звук. */
  manualUseVad: boolean;
  /** Поправка авто-порога, дБ (−10…+10): плюс — чувствительнее (порог ниже), минус — строже. */
  sensitivityDb: number;
  /** Своя автогромкость голоса (учится только на вашей речи). */
  autoGain: boolean;
  /** Ручное усиление: 1 = 100 % (0…2). */
  gain: number;
};

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  noiseSuppression: true,
  gateMode: "auto",
  manualThresholdDb: -45,
  manualUseVad: true,
  sensitivityDb: 0,
  autoGain: true,
  gain: 1,
};

export const MANUAL_THRESHOLD_RANGE = { min: -70, max: -10 } as const;
export const SENSITIVITY_RANGE = { min: -10, max: 10 } as const;
export const GAIN_RANGE = { min: 0, max: 2 } as const;

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

/** Приводит частичные/сохранённые настройки к допустимым значениям. */
export function sanitizeVoiceSettings(raw: Partial<VoiceSettings>, base = DEFAULT_VOICE_SETTINGS): VoiceSettings {
  const mode = raw.gateMode;
  return {
    noiseSuppression: typeof raw.noiseSuppression === "boolean" ? raw.noiseSuppression : base.noiseSuppression,
    gateMode: mode === "auto" || mode === "manual" || mode === "off" ? mode : base.gateMode,
    manualThresholdDb: clampNum(
      raw.manualThresholdDb,
      MANUAL_THRESHOLD_RANGE.min,
      MANUAL_THRESHOLD_RANGE.max,
      base.manualThresholdDb,
    ),
    manualUseVad: typeof raw.manualUseVad === "boolean" ? raw.manualUseVad : base.manualUseVad,
    sensitivityDb: clampNum(raw.sensitivityDb, SENSITIVITY_RANGE.min, SENSITIVITY_RANGE.max, base.sensitivityDb),
    autoGain: typeof raw.autoGain === "boolean" ? raw.autoGain : base.autoGain,
    gain: clampNum(raw.gain, GAIN_RANGE.min, GAIN_RANGE.max, base.gain),
  };
}

/** Снимок метрик для индикатора (≈30 раз в секунду, только пока UI подписан). */
export type VoiceMeter = {
  /** Уровень микрофона как есть, дБFS. */
  rawDb: number;
  /** Уровень, который видит порог (после шумодава), дБFS. С ним сравнивайте thresholdDb. */
  levelDb: number;
  /** Уровень того, что уходит в эфир, дБFS. */
  outDb: number;
  /** Сглаженная вероятность речи 0..1 (NaN — шумодав не работает). */
  vad: number;
  /** Порог открыт (звук идёт в эфир). */
  open: boolean;
  /** Текущий порог, дБFS. */
  thresholdDb: number;
  /** Оценка фона, дБFS (NaN — ещё не набралось). */
  noiseDb: number;
  /** Оценка своего голоса, дБFS (NaN — ещё не говорили). */
  voiceDb: number;
  /** Усиление своей автогромкости, дБ. */
  agcDb: number;
  /** Ослабление лимитером за период, дБ (≤ 0; ниже −3 — перегруз). */
  limiterDb: number;
  /** Среднее (≈за секунду) время обработки кадра 10 мс в worklet, мс (NaN — нет данных). */
  frameMs: number;
};

/** Статус шумодава в worklet. */
export type WorkletStatus = "loading" | "ready" | "error";

export type ToWorklet =
  | { type: "settings"; settings: Partial<VoiceSettings> }
  | { type: "wasm"; bytes: ArrayBuffer }
  | { type: "meter"; on: boolean }
  | { type: "calibrate"; id: number; frames: number }
  /** Сменили микрофон: забыть выученные уровни голоса и фона. */
  | { type: "reset" }
  /** Засеять уровни голоса и фона (сохранённые раньше); NaN — не трогать. */
  | { type: "seed"; voiceDb: number; noiseDb: number }
  | { type: "destroy" };

export type FromWorklet =
  | { type: "status"; status: WorkletStatus; message?: string }
  | { type: "gate"; open: boolean }
  | { type: "meter"; meter: VoiceMeter }
  | { type: "calibration"; id: number; result: CalibrationResult };

/** processorOptions при создании узла. */
export type VoiceProcessorInit = {
  settings: VoiceSettings;
};

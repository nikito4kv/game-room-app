/**
 * Калибровка «скажите фразу 3 секунды»: по уровням и VAD кадров за это время
 * оцениваем свой голос (верхний процентиль кадров речи), фон (нижний процентиль
 * пауз между словами) и предлагаем порог — тем же правилом, что и авто-режим.
 */

export type CalibrationResult = {
  ok: boolean;
  /**
   * Почему не вышло: не услышали речь / голос почти не громче фона / микрофон еле
   * слышно / обработка недоступна (не загрузилась или её остановили).
   */
  reason?: "no-speech" | "noisy" | "too-quiet" | "unavailable";
  /** Уровень своего голоса (верхний процентиль кадров речи), дБFS. */
  voiceDb: number;
  /** Уровень фона в паузах, дБFS. */
  noiseDb: number;
  /** Предлагаемый порог, дБFS. */
  thresholdDb: number;
  /** Сколько речи услышали, мс. */
  speechMs: number;
};

export type CalibrationRules = {
  noiseMarginDb: number;
  voiceMarginDb: number;
  voicePercentile: number;
  noisePercentile: number;
};

/** Меньше этого речи — калибровка не засчитывается. */
const MIN_SPEECH_MS = 500;
/** Голос должен быть громче фона хотя бы на столько, иначе порог их не разделит. */
const MIN_SNR_DB = 10;
/** Тише этого голос считаем «микрофон почти не слышит». */
const TOO_QUIET_DB = -60;
/** VAD кадра речи и кадра паузы. */
const SPEECH_VAD = 0.6;
const PAUSE_VAD = 0.3;
/** Без VAD речью считаем кадры, громче нижней пятой части на столько дБ. */
const LEVEL_ONLY_SNR_DB = 15;

export function percentileOf(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = Math.min(sorted.length - 1, Math.max(0, p * (sorted.length - 1)));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function analyzeCalibration(
  levelsDb: ArrayLike<number>,
  vads: ArrayLike<number>,
  frameMs: number,
  rules: CalibrationRules,
): CalibrationResult {
  const all = Array.from(levelsDb);
  const vadKnown = vads.length === all.length && all.length > 0 && !Number.isNaN(vads[0]);
  const floor = percentileOf(all, 0.2);
  const speech: number[] = [];
  const pauses: number[] = [];
  all.forEach((level, i) => {
    const isSpeech = vadKnown ? vads[i] >= SPEECH_VAD : level >= floor + LEVEL_ONLY_SNR_DB;
    const isPause = vadKnown ? vads[i] < PAUSE_VAD : !isSpeech;
    if (isSpeech) speech.push(level);
    else if (isPause) pauses.push(level);
  });

  const voiceDb = percentileOf(speech, rules.voicePercentile);
  // Пауз между словами может почти не быть — тогда фон берём по самым тихим кадрам.
  const noiseDb = pauses.length >= 10 ? percentileOf(pauses, rules.noisePercentile) : percentileOf(all, 0.05);
  const speechMs = speech.length * frameMs;
  const thresholdDb = Math.max(noiseDb + rules.noiseMarginDb, voiceDb - rules.voiceMarginDb);

  let reason: CalibrationResult["reason"];
  if (speechMs < MIN_SPEECH_MS || Number.isNaN(voiceDb)) reason = "no-speech";
  else if (voiceDb < TOO_QUIET_DB) reason = "too-quiet";
  else if (voiceDb - noiseDb < MIN_SNR_DB) reason = "noisy";
  return { ok: reason === undefined, reason, voiceDb, noiseDb, thresholdDb, speechMs };
}

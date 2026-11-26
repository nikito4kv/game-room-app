import {
  DEFAULT_VOICE_SETTINGS,
  VOICE_FRAME,
  sanitizeVoiceSettings,
  type VoiceMeter,
  type VoiceSettings,
} from "../protocol";
import { VoiceAgc, type AgcTuning } from "./agc";
import { Biquad } from "./biquad";
import { analyzeCalibration, type CalibrationResult } from "./calibration";
import { dbToGain, meanSquare, powerToDb } from "./db";
import { GateEnvelope } from "./envelope";
import { SmartGate, type GateTuning } from "./gate";
import { LookaheadLimiter } from "./limiter";

/**
 * Шумодав для цепочки: обрабатывает кадр VOICE_FRAME сэмплов (float ±1) НА МЕСТЕ
 * и возвращает вероятность речи 0..1 (NaN — модель её не считает). Выход
 * задержан ровно на один кадр — как у RNNoise.
 */
export type Denoiser = {
  processFrame(frame: Float32Array): number;
  destroy(): void;
};

export type PipelineTuning = {
  /** Срез ФВЧ: стук по столу, гул, «бубнение» ниже голоса. */
  highpassHz: number;
  /** Упреждение порога в кадрах по 10 мс: столько звука до срабатывания успевает пройти. */
  lookaheadFrames: number;
  attackMs: number;
  releaseMs: number;
  /** Плавный переход «с шумодавом ↔ без» при переключении. */
  nsCrossfadeMs: number;
  limiterCeilingDb: number;
  limiterLookaheadMs: number;
  limiterReleaseMs: number;
  /** VAD кадра, начиная с которой открытый порог считается «своей речью» для автогромкости. */
  agcVadMin: number;
  gate: Partial<GateTuning>;
  agc: Partial<AgcTuning>;
};

export const DEFAULT_PIPELINE_TUNING: PipelineTuning = {
  highpassHz: 80,
  lookaheadFrames: 3,
  attackMs: 5,
  releaseMs: 120,
  nsCrossfadeMs: 20,
  limiterCeilingDb: -1,
  limiterLookaheadMs: 1,
  limiterReleaseMs: 60,
  agcVadMin: 0.5,
  gate: {},
  agc: {},
};

/** Кадр, ждущий вывода в очереди упреждения. */
type Slot = { buf: Float32Array; open: boolean; vad: number };

type MeterAcc = { raw: number; level: number; out: number; frames: number };

/**
 * Вся обработка своего голоса на кадр 10 мс — чистая логика без Web Audio, её
 * гоняют и worklet, и офлайн-оценка (scripts/audio-eval):
 *
 *   ФВЧ 80 Гц → RNNoise (шумодав + VAD) → умный порог с упреждением →
 *   плавная огибающая → своя автогромкость → усиление → лимитер −1 дБFS
 *
 * Задержка: кадр RNNoise + упреждение + лимитер (1 мс), плюс 9,3 мс переходника
 * блоков в worklet. Без шумодава сухой сигнал задерживается на тот же кадр —
 * переключение не сдвигает звук во времени и идёт плавным перекрёстным переходом.
 */
export class VoicePipeline {
  readonly latency: number;
  readonly frameMs: number;
  readonly gate: SmartGate;
  readonly agc: VoiceAgc;
  private readonly tuning: PipelineTuning;
  private settings: VoiceSettings;
  private denoiser: Denoiser | null = null;

  private readonly hpf: Biquad;
  private readonly envelope: GateEnvelope;
  private readonly limiter: LookaheadLimiter;
  private readonly hp = new Float32Array(VOICE_FRAME);
  private readonly hpPrev = new Float32Array(VOICE_FRAME);
  private readonly dry = new Float32Array(VOICE_FRAME);
  private readonly ns = new Float32Array(VOICE_FRAME);
  private readonly nsStep: number;
  private nsMix = 0;

  // Очередь упреждения (старший кадр — первый) и свободный слот под текущий кадр.
  // Слоты переиспользуются по кругу: в аудиопотоке не выделяем память.
  private readonly queue: Slot[] = [];
  private free: Slot;
  private reportedOpen = false;
  private outGain: number;

  private acc: MeterAcc = { raw: 0, level: 0, out: 0, frames: 0 };
  private calib: { left: number; levels: number[]; vads: number[]; done: (r: CalibrationResult) => void } | null =
    null;

  /** Переходы «порог открыт/закрыт» (для индикатора «я говорю»). */
  onGateChange: ((open: boolean) => void) | null = null;

  constructor(sampleRate: number, settings: Partial<VoiceSettings> = {}, tuning: Partial<PipelineTuning> = {}) {
    this.tuning = { ...DEFAULT_PIPELINE_TUNING, ...tuning };
    const t = this.tuning;
    this.frameMs = (VOICE_FRAME / sampleRate) * 1000;
    this.settings = sanitizeVoiceSettings(settings, DEFAULT_VOICE_SETTINGS);
    this.hpf = Biquad.highpass(sampleRate, t.highpassHz);
    this.envelope = new GateEnvelope(sampleRate, t.attackMs, t.releaseMs);
    this.limiter = new LookaheadLimiter(sampleRate, t.limiterCeilingDb, t.limiterLookaheadMs, t.limiterReleaseMs);
    this.gate = new SmartGate(this.frameMs, t.gate);
    this.agc = new VoiceAgc(this.frameMs, t.agc);
    this.nsStep = 1 / Math.max(1, (t.nsCrossfadeMs / 1000) * sampleRate);
    this.outGain = this.settings.gain;
    const lookahead = Math.max(0, Math.round(t.lookaheadFrames));
    const slot = (): Slot => ({ buf: new Float32Array(VOICE_FRAME), open: false, vad: NaN });
    for (let i = 0; i < lookahead; i++) this.queue.push(slot());
    this.free = slot();
    this.latency = (1 + lookahead) * VOICE_FRAME + this.limiter.latency;
    this.applyGateSettings();
  }

  get hasDenoiser(): boolean {
    return this.denoiser !== null;
  }

  /** Подключить шумодав (null — работать без него: порог только по уровню). */
  setDenoiser(denoiser: Denoiser | null): void {
    this.denoiser?.destroy();
    this.denoiser = denoiser;
    if (!denoiser) this.nsMix = 0;
  }

  update(patch: Partial<VoiceSettings>): void {
    this.settings = sanitizeVoiceSettings(patch, this.settings);
    this.applyGateSettings();
  }

  getSettings(): VoiceSettings {
    return { ...this.settings };
  }

  /** Начать калибровку на frames кадров; done получит результат. Повторный вызов перезапускает. */
  calibrate(frames: number, done: (result: CalibrationResult) => void): void {
    this.calib = { left: Math.max(1, Math.round(frames)), levels: [], vads: [], done };
  }

  /** Обрабатывает кадр: input (VOICE_FRAME сэмплов) → output (та же длина, с задержкой latency). */
  process(input: Float32Array, output: Float32Array): void {
    const s = this.settings;
    const rawPower = meanSquare(input);
    // NaN во входе навсегда отравил бы состояние фильтра и RNNoise — такой кадр глушим.
    const inputOk = Number.isFinite(rawPower);
    this.acc.raw += inputOk ? rawPower : 0;

    // 1) ФВЧ; сухой путь задержан на кадр — как выход шумодава.
    if (inputOk) this.hp.set(input);
    else this.hp.fill(0);
    this.hpf.process(this.hp);
    this.dry.set(this.hpPrev);
    this.hpPrev.set(this.hp);

    // 2) Шумодав и VAD. Модель крутим, пока нужен её звук, VAD или идёт переход.
    const nsTarget = this.denoiser && s.noiseSuppression ? 1 : 0;
    const needVad = s.gateMode !== "manual" || s.manualUseVad;
    let vad = NaN;
    if (this.denoiser && (nsTarget === 1 || needVad || this.nsMix > 0)) {
      this.ns.set(this.hp);
      vad = this.denoiser.processFrame(this.ns);
    }

    // 3) Текущий кадр: шумодав / сухой / плавный переход между ними.
    const slot = this.free;
    const cur = slot.buf;
    if (this.nsMix === nsTarget) {
      cur.set(nsTarget === 1 ? this.ns : this.dry);
    } else {
      const up = nsTarget === 1;
      let m = this.nsMix;
      for (let i = 0; i < VOICE_FRAME; i++) {
        m = up ? Math.min(1, m + this.nsStep) : Math.max(0, m - this.nsStep);
        cur[i] = m * this.ns[i] + (1 - m) * this.dry[i];
      }
      this.nsMix = m;
    }

    // 4) Решение порога по текущему кадру.
    const levelPower = meanSquare(cur);
    const levelDb = powerToDb(levelPower);
    slot.vad = vad;
    slot.open = this.gate.update(levelDb, vad);
    this.acc.level += levelPower;
    this.captureCalibration(levelDb, vad);
    this.queue.push(slot);

    // 5) Выводим старший кадр очереди. Огибающая открывается заранее, если речь
    //    есть в любом из кадров впереди, — тихое начало слова не съедается.
    const out = this.queue.shift()!;
    let anyOpen = out.open;
    for (const q of this.queue) anyOpen = anyOpen || q.open;
    this.envelope.apply(out.buf, s.gateMode === "off" ? true : anyOpen);
    const ownSpeech = out.open && !Number.isNaN(out.vad) && out.vad >= this.tuning.agcVadMin;
    const agcDb = this.agc.update(this.gate.voiceDb, ownSpeech, s.autoGain);
    this.rampGain(out.buf, dbToGain(agcDb) * s.gain);
    this.limiter.process(out.buf);
    output.set(out.buf);
    this.acc.out += meanSquare(output);
    this.acc.frames++;
    this.free = out;

    if (anyOpen !== this.reportedOpen) {
      this.reportedOpen = anyOpen;
      this.onGateChange?.(anyOpen);
    }
  }

  /** Снимок метрик с прошлого вызова (средние уровни за период + текущее состояние). */
  takeMeter(frameMs = NaN): VoiceMeter {
    const a = this.acc;
    const n = Math.max(1, a.frames);
    const meter: VoiceMeter = {
      rawDb: powerToDb(a.raw / n),
      levelDb: powerToDb(a.level / n),
      outDb: powerToDb(a.out / n),
      vad: this.gate.vad,
      open: this.reportedOpen,
      thresholdDb: this.gate.thresholdDb,
      noiseDb: this.gate.noiseDb,
      voiceDb: this.gate.voiceDb,
      agcDb: this.agc.gainDb,
      limiterDb: this.limiter.takeReductionDb(),
      frameMs,
    };
    this.acc = { raw: 0, level: 0, out: 0, frames: 0 };
    return meter;
  }

  private applyGateSettings(): void {
    const s = this.settings;
    this.gate.setDetector(s.gateMode === "manual" ? "manual" : "auto");
    this.gate.setManualThreshold(s.manualThresholdDb);
    this.gate.setManualUseVad(s.manualUseVad);
    this.gate.setSensitivity(s.sensitivityDb);
  }

  /** Линейно ведёт итоговое усиление от прошлого значения к новому за кадр — без щелчков. */
  private rampGain(buf: Float32Array, next: number): void {
    const prev = this.outGain;
    if (prev === next) {
      if (next !== 1) for (let i = 0; i < buf.length; i++) buf[i] *= next;
    } else {
      const step = (next - prev) / buf.length;
      for (let i = 0; i < buf.length; i++) buf[i] *= prev + step * (i + 1);
    }
    this.outGain = next;
  }

  private captureCalibration(levelDb: number, vad: number): void {
    const c = this.calib;
    if (!c) return;
    c.levels.push(levelDb);
    c.vads.push(vad);
    if (--c.left > 0) return;
    this.calib = null;
    const g = this.gate.tuning;
    const result = analyzeCalibration(c.levels, c.vads, this.frameMs, {
      noiseMarginDb: g.noiseMarginDb,
      voiceMarginDb: g.voiceMarginDb,
      voicePercentile: g.voicePercentile,
      noisePercentile: g.noisePercentile,
    });
    if (result.ok) this.gate.seed(result.voiceDb, result.noiseDb);
    c.done(result);
  }
}

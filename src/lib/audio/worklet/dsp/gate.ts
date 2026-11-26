import { clamp } from "./db";
import { DecayingHistogram } from "./histogram";

/**
 * Умный порог (noise gate) — решает по кадрам 10 мс, пускать ли звук в эфир.
 *
 * Главная беда компьютерного клуба — голоса соседей. Шумодав их не уберёт:
 * для него речь соседа — тоже речь. Зато свой голос в гарнитуре почти всегда
 * громче соседского (микрофон у рта), и на этом построен порог:
 *  • открывается, только если уровень выше порога И нейросеть (VAD RNNoise)
 *    уверена, что это речь, — клавиатура и стук не открывают;
 *  • в авто-режиме порог считается от ТВОЕГО голоса: верхний процентиль
 *    громкости кадров с речью минус запас, но не ниже фона плюс запас;
 *  • закрывается с гистерезисом и удержанием — конец слова не обрубается.
 * Пока говоришь сам, сосед проходит «подложкой» — это честный предел подхода.
 *
 * Здесь только решение «открыт/закрыт» по кадру. Плавность (атака, отпускание)
 * — в envelope.ts, упреждение — в pipeline.ts.
 */

export type GateDetector = "auto" | "manual";

/** Настраиваемые константы порога. Значения по умолчанию подобраны офлайн-оценкой (scripts/audio-eval). */
export type GateTuning = {
  /** Порог не ниже фона + столько дБ. */
  noiseMarginDb: number;
  /** Порог на столько дБ ниже оценки своего голоса. */
  voiceMarginDb: number;
  /** Гистерезис: открытый порог держится, пока уровень выше «порог − столько дБ». */
  hysteresisDb: number;
  /** Удержание открытым после того, как условие перестало выполняться. */
  holdMs: number;
  /** Сглаженная VAD для открытия. */
  vadOpen: number;
  /** Сглаженная VAD, при которой открытый порог ещё держится. */
  vadStay: number;
  /** Постоянные времени сглаживания VAD: рост и спад. */
  vadRiseMs: number;
  vadFallMs: number;
  /** Сколько кадров подряд должно выполняться условие открытия. */
  openFrames: number;
  /** Фон: процентиль уровня кадров без речи и «полураспад» памяти (в кадрах-кандидатах). */
  noisePercentile: number;
  noiseHalfLifeFrames: number;
  /** Кадр считается «без речи» для оценки фона, если сглаженная VAD ниже этого. */
  noiseVadMax: number;
  /** Свой голос: процентиль громкости кадров с речью и полураспад памяти (в кадрах речи). */
  voicePercentile: number;
  voiceHalfLifeFrames: number;
  /** Кадр идёт в оценку голоса, если VAD не ниже этого… */
  voiceVadMin: number;
  /** …он громче фона хотя бы на столько дБ… */
  voiceMinSnrDb: number;
  /** …и не тише текущей оценки голоса больше чем на столько дБ (далёкие соседи не сбивают оценку). */
  voiceWindowDb: number;
  /** Сколько кадров речи нужно, чтобы показывать оценку голоса в интерфейсе. */
  voiceMinFrames: number;
  /** Приор: типичный уровень голоса в гарнитуре (верхний процентиль), пока своих данных нет. */
  priorVoiceDb: number;
  /**
   * Вес приора в гистограмме голоса (в кадрах). С ним далёкая речь (тише приора
   * больше чем на voiceWindowDb) не принимается за «свой голос», пока вы молчите;
   * 0 — приор только до первых voiceMinFrames кадров речи.
   */
  priorWeight: number;
  /**
   * Сколько кадров речи подряд «ниже окна» должно пройти без единого своего кадра,
   * чтобы переучиться с нуля (вы убавили микрофон — порог не должен запереть вас).
   */
  relearnFrames: number;
  /** Пределы итогового порога. */
  minThresholdDb: number;
  maxThresholdDb: number;
};

export const DEFAULT_GATE_TUNING: GateTuning = {
  noiseMarginDb: 8,
  voiceMarginDb: 11,
  hysteresisDb: 4,
  holdMs: 200,
  vadOpen: 0.5,
  vadStay: 0.25,
  vadRiseMs: 10,
  vadFallMs: 80,
  openFrames: 1,
  noisePercentile: 0.2,
  noiseHalfLifeFrames: 300,
  noiseVadMax: 0.3,
  voicePercentile: 0.9,
  voiceHalfLifeFrames: 2000,
  voiceVadMin: 0.85,
  voiceMinSnrDb: 10,
  voiceWindowDb: 20,
  voiceMinFrames: 30,
  priorVoiceDb: -26,
  priorWeight: 10,
  relearnFrames: 2000,
  minThresholdDb: -70,
  maxThresholdDb: -10,
};

/** Без VAD (шумодав не загрузился) речь угадываем только по уровню: громче фона на столько дБ. */
const LEVEL_ONLY_SPEECH_SNR_DB = 15;

export class SmartGate {
  readonly tuning: GateTuning;
  private readonly noiseHist: DecayingHistogram;
  private readonly voiceHist: DecayingHistogram;
  private readonly holdFrames: number;
  private readonly vadRise: number;
  private readonly vadFall: number;

  private detector: GateDetector = "auto";
  private manualDb = -50;
  private manualVad = true;
  private sensitivity = 0;

  private vadSmooth = NaN;
  private isOpen = false;
  private holdLeft = 0;
  private openStreak = 0;
  private noise = NaN;
  /** Оценка голоса для порога (с приором). */
  private voice: number;
  /** Сколько своих кадров речи учтено (без приора). */
  private voiceFrames = 0;
  /** Оценка на что-то опирается (приор или своя речь) — действует окно «не далёкая речь». */
  private anchored: boolean;
  /** Кадров речи подряд, отброшенных окном (для переобучения, если мы стали тише). */
  private rejectedRun = 0;
  private threshold: number;

  constructor(frameMs: number, tuning: Partial<GateTuning> = {}) {
    this.tuning = { ...DEFAULT_GATE_TUNING, ...tuning };
    const t = this.tuning;
    this.noiseHist = new DecayingHistogram(-100, 0, 0.5, t.noiseHalfLifeFrames);
    this.voiceHist = new DecayingHistogram(-100, 0, 0.5, t.voiceHalfLifeFrames);
    if (t.priorWeight > 0) this.voiceHist.add(t.priorVoiceDb, t.priorWeight);
    this.voice = t.priorVoiceDb;
    this.anchored = t.priorWeight > 0;
    this.holdFrames = Math.max(1, Math.round(t.holdMs / frameMs));
    this.vadRise = 1 - Math.exp(-frameMs / t.vadRiseMs);
    this.vadFall = 1 - Math.exp(-frameMs / t.vadFallMs);
    this.threshold = this.computeThreshold();
  }

  setDetector(detector: GateDetector): void {
    this.detector = detector;
    this.threshold = this.computeThreshold();
  }
  setManualThreshold(db: number): void {
    this.manualDb = db;
    this.threshold = this.computeThreshold();
  }
  setManualUseVad(on: boolean): void {
    this.manualVad = on;
  }
  /** Поправка авто-порога: плюс — чувствительнее (порог ниже), минус — строже. */
  setSensitivity(db: number): void {
    this.sensitivity = db;
    this.threshold = this.computeThreshold();
  }

  get open(): boolean {
    return this.isOpen;
  }
  get thresholdDb(): number {
    return this.threshold;
  }
  get noiseDb(): number {
    return this.noise;
  }
  /** Оценка своего голоса (верхний процентиль); NaN, пока своей речи было мало. */
  get voiceDb(): number {
    return this.voiceFrames >= this.tuning.voiceMinFrames ? this.voice : NaN;
  }
  get vad(): number {
    return this.vadSmooth;
  }

  /**
   * Учитывает очередной кадр и возвращает, открыт ли порог на нём.
   * levelDb — RMS-уровень кадра (то, что пойдёт в эфир); vad — вероятность речи
   * 0..1 от RNNoise или NaN, если её нет.
   */
  update(levelDb: number, vad: number): boolean {
    const t = this.tuning;
    const vadKnown = !Number.isNaN(vad);
    if (vadKnown) {
      if (Number.isNaN(this.vadSmooth)) this.vadSmooth = vad;
      else this.vadSmooth += (vad - this.vadSmooth) * (vad > this.vadSmooth ? this.vadRise : this.vadFall);
    } else {
      this.vadSmooth = NaN;
    }

    this.learn(levelDb, vad);
    this.threshold = this.computeThreshold();

    const useVad = vadKnown && (this.detector === "auto" || this.manualVad);
    const thr = this.threshold;
    const canOpen = levelDb > thr && (!useVad || this.vadSmooth >= t.vadOpen);
    if (!this.isOpen) {
      this.openStreak = canOpen ? this.openStreak + 1 : 0;
      if (this.openStreak >= t.openFrames) {
        this.isOpen = true;
        this.holdLeft = this.holdFrames;
      }
    } else {
      const canStay = levelDb > thr - t.hysteresisDb && (!useVad || this.vadSmooth >= t.vadStay);
      if (canOpen || canStay) this.holdLeft = this.holdFrames;
      else if (--this.holdLeft <= 0) {
        this.isOpen = false;
        this.openStreak = 0;
      }
    }
    return this.isOpen;
  }

  /**
   * Засеять оценки результатом калибровки (своя фраза): голос и фон сразу
   * становятся известны, а не набираются за первые секунды разговора.
   */
  seed(voiceDb: number, noiseDb: number): void {
    const t = this.tuning;
    if (Number.isFinite(voiceDb)) {
      this.voiceHist.clear();
      // Вес — как у пары секунд речи: свежие кадры дальше уточняют оценку.
      this.voiceHist.add(voiceDb, t.voiceMinFrames * 4);
      this.voice = voiceDb;
      this.voiceFrames = Math.max(this.voiceFrames, t.voiceMinFrames);
      this.anchored = true;
      this.rejectedRun = 0;
    }
    if (Number.isFinite(noiseDb)) {
      this.noiseHist.clear();
      this.noiseHist.add(noiseDb, 20);
      this.noise = noiseDb;
    }
    this.threshold = this.computeThreshold();
  }

  /**
   * Забыть выученные уровни голоса и фона (сменили микрофон — уровни другие).
   * Оценка голоса возвращается к приору.
   */
  resetLearning(): void {
    const t = this.tuning;
    this.noiseHist.clear();
    this.noise = NaN;
    this.voiceHist.clear();
    if (t.priorWeight > 0) this.voiceHist.add(t.priorVoiceDb, t.priorWeight);
    this.voice = t.priorVoiceDb;
    this.voiceFrames = 0;
    this.anchored = t.priorWeight > 0;
    this.rejectedRun = 0;
    this.threshold = this.computeThreshold();
  }

  private learn(levelDb: number, vad: number): void {
    const t = this.tuning;
    const vadKnown = !Number.isNaN(vad);
    // Фон: кадры без речи. Без VAD — все кадры (нижний процентиль сам отсеет речь).
    if (!vadKnown || this.vadSmooth < t.noiseVadMax) {
      this.noiseHist.add(levelDb);
      if (this.noiseHist.weight >= 10) this.noise = this.noiseHist.percentile(t.noisePercentile);
    }
    // Свой голос: уверенная речь заметно громче фона…
    const noise = Number.isNaN(this.noise) ? -100 : this.noise;
    const isSpeech = vadKnown ? vad >= t.voiceVadMin : levelDb >= noise + LEVEL_ONLY_SPEECH_SNR_DB;
    if (!isSpeech || levelDb < noise + t.voiceMinSnrDb) return;
    // …и не «далёкая»: сильно тише текущей оценки — скорее сосед, не учимся на нём.
    // Но если долго слышна только такая речь, значит, это мы стали тише (убавили
    // микрофон) — тогда переучиваемся с нуля, иначе порог запер бы нас навсегда.
    if (this.anchored && levelDb < this.voice - t.voiceWindowDb) {
      if (++this.rejectedRun >= t.relearnFrames) {
        this.voiceHist.clear();
        this.voiceFrames = 0;
        this.anchored = false;
        this.rejectedRun = 0;
      }
      return;
    }
    this.rejectedRun = 0;
    this.voiceHist.add(levelDb);
    this.voiceFrames++;
    if (this.anchored || this.voiceHist.weight >= t.voiceMinFrames) {
      this.voice = this.voiceHist.percentile(t.voicePercentile);
      this.anchored = true;
    }
  }

  private computeThreshold(): number {
    const t = this.tuning;
    if (this.detector === "manual") return clamp(this.manualDb, t.minThresholdDb, t.maxThresholdDb);
    const byNoise = Number.isNaN(this.noise) ? -Infinity : this.noise + t.noiseMarginDb;
    const base = Math.max(byNoise, this.voice - t.voiceMarginDb);
    return clamp(base - this.sensitivity, t.minThresholdDb, t.maxThresholdDb);
  }
}

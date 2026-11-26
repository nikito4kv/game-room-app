import { Track } from "livekit-client";
import type { AudioProcessorOptions, TrackProcessor } from "livekit-client";
import { CALIBRATION_UNAVAILABLE, VoiceNode, loadRnnoiseWasm } from "./voiceNode";
import {
  DEFAULT_VOICE_SETTINGS,
  VOICE_FRAME,
  VOICE_SAMPLE_RATE,
  sanitizeVoiceSettings,
  type CalibrationResult,
  type GateMode,
  type VoiceMeter,
  type VoiceSettings,
  type WorkletStatus,
} from "./worklet/protocol";

export type { CalibrationResult, GateMode, VoiceMeter, VoiceSettings };

/**
 * Состояние обработки микрофона для интерфейса.
 *  • idle — не запущена (до публикации трека или после остановки);
 *  • loading — грузится шумодав (звук уже идёт, пока без него);
 *  • ready — всё работает;
 *  • error — шумодав недоступен; звук всё равно идёт (моно + усиление + лимитер),
 *    а для reason "worklet" нет и порога. По этому сигналу комната перезахватывает
 *    микрофон с браузерным шумодавом (ourNoiseSuppression: false, см. useMic).
 */
export type MicStatus = {
  state: "idle" | "loading" | "ready" | "error";
  reason?: "worklet" | "wasm" | "sample-rate" | "timeout";
  /** Подробности для логов. */
  message?: string;
  /** Браузер ждёт клика по странице (автозапуск звука): пока его нет, в эфир идёт тишина. */
  blocked: boolean;
};

/** Сколько ждать запуска AudioContext: при запрете автозапуска resume() висит до жеста. */
const RESUME_WAIT_MS = 300;
/** Загрузка модуля worklet — дольше считаем сбоем и идём без него. */
const MODULE_TIMEOUT_MS = 5000;
/** Загрузка RNNoise — дольше считаем сбоем (придёт позже — статус исправится). */
const WASM_TIMEOUT_MS = 8000;
/** Метрики запасной цепочки (без worklet) — опрос, только пока UI подписан. */
const FALLBACK_METER_MS = 33;

/**
 * Обработка СВОЕГО микрофона перед публикацией в LiveKit — один TrackProcessor
 * на весь конвейер (LiveKit допускает только один процессор на трек):
 *
 *   микрофон → [AudioWorklet «voice-processor»: моно → ФВЧ 80 Гц → RNNoise (+VAD)
 *     → умный порог с упреждением → огибающая → своя автогромкость → усиление
 *     → лимитер] → выход (моно)
 *
 * Логика цепочки — src/lib/audio/worklet (подробно там). Если worklet не
 * загрузился, работает запасная цепочка: моно → усиление → лимитер.
 *
 * Контекст СВОЙ и на 48 кГц: LiveKit создаёт AudioContext на системной частоте
 * (бывает 44,1 кГц), а RNNoise работает только на 48 кГц. Поэтому
 * opts.audioContext не используется.
 *
 * Жизненный цикл (по поведению livekit-client):
 *  • init    — первичная сборка после публикации трека;
 *  • restart — смена устройства: меняем только источник; контекст, worklet,
 *              выученные уровни (если микрофон тот же) и processedTrack живут
 *              дальше, поэтому LiveKit не меняет дорожку у отправителя;
 *  • destroy — трек остановлен: гасим всё и закрываем контекст. Инстанс
 *              живой — новый трек (вернули микрофон, переподключились) снова
 *              придёт в init() и соберёт всё заново.
 *
 * setProcessor помечен @experimental — поэтому всё изолировано в одном модуле.
 */
export class MicProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name = "mic-pipeline";
  processedTrack?: MediaStreamTrack;

  private settings: VoiceSettings;
  private ctx?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private voice?: VoiceNode;
  private fallback?: { gain: GainNode; limiter: DynamicsCompressorNode; analyser?: AnalyserNode };
  private destination?: MediaStreamAudioDestinationNode;
  private deviceId?: string;

  /** Неизменяемый снимок: новый объект только при настоящей смене (удобно для useSyncExternalStore). */
  private statusValue: MicStatus = Object.freeze({ state: "idle", blocked: false });
  private lastNs?: boolean;
  private gateOpen = false;
  private loadTimer?: ReturnType<typeof setTimeout>;
  private meterTimer?: ReturnType<typeof setInterval>;
  private stopGestureWait?: () => void;

  private readonly statusListeners = new Set<(status: MicStatus) => void>();
  private readonly gateListeners = new Set<(open: boolean) => void>();
  private readonly meterListeners = new Set<(meter: VoiceMeter) => void>();

  /**
   * Колбэк ФАКТИЧЕСКОГО состояния шумоподавления: зовётся, когда оно
   * определилось (загрузка RNNoise удалась/провалилась, переключили). Передаётся
   * конструктором, т.к. инстанс живёт в useState и мутировать его снаружи нельзя.
   */
  private readonly onNoiseSuppressionChange?: (enabled: boolean) => void;

  constructor(
    initialGain = 1,
    initialNoiseSuppression = true,
    onNoiseSuppressionChange?: (enabled: boolean) => void,
    initialSettings: Partial<VoiceSettings> = {},
  ) {
    this.settings = sanitizeVoiceSettings(
      { ...initialSettings, gain: initialGain, noiseSuppression: initialNoiseSuppression },
      DEFAULT_VOICE_SETTINGS,
    );
    this.onNoiseSuppressionChange = onNoiseSuppressionChange;
  }

  // ---------------------------------------------------------------- жизненный цикл

  async init(opts: AudioProcessorOptions): Promise<void> {
    await this.start(opts.track);
  }

  /** Запуск на дорожке без LiveKit (проверка микрофона): то же, что init. */
  async start(track: MediaStreamTrack): Promise<void> {
    await this.setup(track, VOICE_SAMPLE_RATE);
  }

  /** Частота контекста обработки (undefined — не запущена). */
  get sampleRate(): number | undefined {
    return this.ctx?.sampleRate;
  }

  async restart(opts: AudioProcessorOptions): Promise<void> {
    if (!this.ctx || !this.destination) return this.init(opts);
    try {
      this.connectSource(opts.track);
    } catch {
      // Контекст не принимает новый микрофон (Firefox: другая частота) — собираем
      // заново; LiveKit возьмёт новый processedTrack после restart.
      await this.destroy();
      return this.init(opts);
    }
    const device = deviceOf(opts.track);
    if (device !== this.deviceId) this.voice?.resetLearning(); // другой микрофон — другие уровни
    this.deviceId = device;
  }

  async destroy(): Promise<void> {
    const ctx = this.ctx;
    // Первым делом отвязываем контекст: «опоздавшие» шаги init увидят расхождение
    // и не тронут новый контекст следующего init().
    this.ctx = undefined;
    clearTimeout(this.loadTimer);
    this.stopFallbackMeter();
    this.stopGestureWait?.();
    this.stopGestureWait = undefined;
    this.source?.disconnect();
    this.voice?.destroy();
    if (this.fallback) {
      this.fallback.gain.disconnect();
      this.fallback.limiter.disconnect();
    }
    this.destination?.disconnect();
    // Висячая дорожка после смены устройства/остановки — аудит 1-audio, 3.17.
    this.processedTrack?.stop();
    this.source = undefined;
    this.voice = undefined;
    this.fallback = undefined;
    this.destination = undefined;
    this.processedTrack = undefined;
    this.deviceId = undefined;
    if (this.gateOpen) this.emitGate(false);
    this.setStatus({ state: "idle", reason: undefined, message: undefined, blocked: false });
    await ctx?.close().catch(() => {});
  }

  // ---------------------------------------------------------------- старый API

  /** Ручное усиление вживую: 1 = 100 % (0…2). Меняется плавно, без щелчков. */
  setGain(value: number): void {
    this.updateSettings({ gain: value });
  }

  /**
   * Шумодав вкл/выкл вживую (плавный переход, без переиздания трека). Возвращает
   * фактическое состояние — false, если шумодав недоступен.
   */
  async setNoiseSuppression(on: boolean): Promise<boolean> {
    this.updateSettings({ noiseSuppression: on });
    return this.nsActual();
  }

  // ---------------------------------------------------------------- новые настройки

  setGateMode(mode: GateMode): void {
    this.updateSettings({ gateMode: mode });
  }
  /** Порог ручного режима, дБFS (−70…−10). */
  setManualThreshold(db: number): void {
    this.updateSettings({ manualThresholdDb: db });
  }
  /** В ручном режиме открывать порог только на речь. */
  setManualUseVad(on: boolean): void {
    this.updateSettings({ manualUseVad: on });
  }
  /** Поправка авто-порога, дБ (−10…+10): плюс — чувствительнее, минус — строже. */
  setSensitivity(db: number): void {
    this.updateSettings({ sensitivityDb: db });
  }
  /** Своя автогромкость голоса. */
  setAutoGain(on: boolean): void {
    this.updateSettings({ autoGain: on });
  }

  /** Любые настройки разом (значения приводятся к допустимым). */
  updateSettings(patch: Partial<VoiceSettings>): void {
    this.settings = sanitizeVoiceSettings(patch, this.settings);
    const applied: Partial<VoiceSettings> = {};
    for (const key of Object.keys(patch) as (keyof VoiceSettings)[]) {
      Object.assign(applied, { [key]: this.settings[key] });
    }
    this.voice?.update(applied);
    if (this.fallback && "gain" in patch) {
      const g = this.fallback.gain.gain;
      g.setTargetAtTime(this.settings.gain, this.fallback.gain.context.currentTime, 0.02);
    }
    if ("noiseSuppression" in patch) this.notifyNs(true);
  }

  getSettings(): VoiceSettings {
    return { ...this.settings };
  }

  // ---------------------------------------------------------------- состояние и события

  /** Текущий статус — тот же объект, пока статус не изменился. */
  get status(): MicStatus {
    return this.statusValue;
  }

  /** Подписка на статус; сразу зовётся с текущим. Возвращает отписку. */
  onStatus(cb: (status: MicStatus) => void): () => void {
    this.statusListeners.add(cb);
    cb(this.status);
    return () => this.statusListeners.delete(cb);
  }

  /** Порог сейчас открыт (голос идёт в эфир). */
  get isGateOpen(): boolean {
    return this.gateOpen;
  }

  /**
   * Переходы порога «открыт/закрыт» — для индикатора «я говорю». Приходят всегда,
   * без подписки на метрики. В режиме порога «off» — по авто-детектору речи.
   * Без worklet (status.reason "worklet") событий нет.
   */
  onGateChange(cb: (open: boolean) => void): () => void {
    this.gateListeners.add(cb);
    return () => this.gateListeners.delete(cb);
  }

  /**
   * Метрики ≈30 раз в секунду, пока есть хоть один подписчик (без подписчиков
   * worklet их не считает и не шлёт). Возвращает отписку.
   */
  subscribeMeter(cb: (meter: VoiceMeter) => void): () => void {
    this.meterListeners.add(cb);
    if (this.meterListeners.size === 1) this.applyMeter(true);
    return () => {
      if (this.meterListeners.delete(cb) && this.meterListeners.size === 0) this.applyMeter(false);
    };
  }

  /**
   * Калибровка: попросите сказать фразу durationMs (≈3 с). Результат — уровень
   * голоса, фона и предложенный порог; при успехе авто-порог сразу на них опирается.
   */
  async calibrate(durationMs = 3000): Promise<CalibrationResult> {
    const ctx = this.ctx;
    if (!this.voice || !ctx) return CALIBRATION_UNAVAILABLE;
    const frames = Math.max(1, Math.round((durationMs / 1000) * (ctx.sampleRate / VOICE_FRAME)));
    return this.voice.calibrate(frames);
  }

  /**
   * Засеять уровни голоса и фона (например, сохранённые с прошлого раза): авто-порог
   * не учится заново и не принимает соседа за вас, пока вы не заговорили.
   */
  seedVoiceProfile(voiceDb: number, noiseDb = NaN): void {
    this.voice?.seed(voiceDb, noiseDb);
  }

  /** Забыть выученные уровни голоса и фона. */
  resetLearning(): void {
    this.voice?.resetLearning();
  }

  // ---------------------------------------------------------------- сборка

  private async setup(track: MediaStreamTrack, sampleRate: number | undefined): Promise<void> {
    // Повторный запуск без destroy (чужой вызов) — старое не оставляем висеть.
    if (this.ctx) await this.destroy();
    const ctx = openContext(sampleRate);
    this.ctx = ctx;
    await this.resumeBounded(ctx);
    if (ctx !== this.ctx) return;
    await this.buildChain(ctx);
    if (ctx !== this.ctx) return;
    try {
      this.connectSource(track);
    } catch (e) {
      // Firefox не соединяет микрофон с контекстом другой частоты. Без 48 кГц
      // RNNoise не работает, но порог, автогромкость и лимитер — да.
      if (sampleRate === undefined) throw e;
      await this.destroy();
      return this.setup(track, undefined);
    }
    this.deviceId = deviceOf(track);
    this.processedTrack = this.destination?.stream.getAudioTracks()[0];
    this.notifyNs(true);
  }

  /**
   * resume() при запрете автозапуска не отклоняется, а ВИСИТ до жеста
   * пользователя — ждём ограниченно, иначе init держал бы замок трека LiveKit
   * бесконечно (аудит 1-audio, 3.4). Не запустился — ждём первого клика/клавиши.
   */
  private async resumeBounded(ctx: AudioContext): Promise<void> {
    if (ctx.state !== "suspended") return;
    await Promise.race([ctx.resume().catch(() => {}), sleep(RESUME_WAIT_MS)]);
    if (ctx.state !== "suspended" || ctx !== this.ctx) return;
    const resume = () => void ctx.resume().catch(() => {});
    const stop = () => {
      window.removeEventListener("pointerdown", resume, true);
      window.removeEventListener("keydown", resume, true);
      ctx.removeEventListener("statechange", onState);
    };
    const onState = () => {
      if (ctx.state === "suspended") return;
      stop();
      this.stopGestureWait = undefined;
      if (ctx === this.ctx) this.setStatus({ blocked: false });
    };
    window.addEventListener("pointerdown", resume, true);
    window.addEventListener("keydown", resume, true);
    ctx.addEventListener("statechange", onState);
    this.stopGestureWait = stop;
    this.setStatus({ blocked: true });
  }

  private async buildChain(ctx: AudioContext): Promise<void> {
    const destination = ctx.createMediaStreamDestination();
    destination.channelCount = 1;
    this.destination = destination;
    try {
      await withTimeout(VoiceNode.loadModule(ctx), MODULE_TIMEOUT_MS, "worklet не загрузился за 5 с");
      if (ctx !== this.ctx) return;
      const voice = new VoiceNode(ctx, this.settings, {
        onStatus: (status, message) => this.onWorkletStatus(voice, status, message),
        onGate: (open) => this.emitGate(open),
        onMeter: (meter) => this.emitMeter(meter),
      });
      voice.node.connect(destination);
      this.voice = voice;
      if (this.meterListeners.size > 0) voice.setMeter(true);
      this.feedWasm(ctx, voice);
    } catch (e) {
      if (ctx !== this.ctx) return;
      this.buildFallback(ctx, destination);
      this.setStatus({ state: "error", reason: "worklet", message: errorText(e) });
    }
  }

  /** wasm RNNoise в worklet. Пока он грузится, звук идёт без шумодава. */
  private feedWasm(ctx: AudioContext, voice: VoiceNode): void {
    if (ctx.sampleRate !== VOICE_SAMPLE_RATE) {
      this.setStatus({ state: "error", reason: "sample-rate", message: `контекст ${ctx.sampleRate} Гц` });
      return;
    }
    this.setStatus({ state: "loading", reason: undefined, message: undefined });
    clearTimeout(this.loadTimer);
    this.loadTimer = setTimeout(() => {
      if (this.voice === voice && this.statusValue.state === "loading") {
        this.setStatus({ state: "error", reason: "timeout", message: "шумодав не загрузился за 8 с" });
      }
    }, WASM_TIMEOUT_MS);
    loadRnnoiseWasm().then(
      (bytes) => {
        if (this.voice === voice) voice.provideWasm(bytes);
      },
      (e: unknown) => {
        if (this.voice !== voice) return;
        clearTimeout(this.loadTimer);
        this.setStatus({ state: "error", reason: "wasm", message: errorText(e) });
      },
    );
  }

  private onWorkletStatus(voice: VoiceNode, status: WorkletStatus, message?: string): void {
    if (this.voice !== voice) return;
    if (status === "ready") {
      clearTimeout(this.loadTimer);
      this.setStatus({ state: "ready", reason: undefined, message: undefined });
    } else if (status === "error") {
      clearTimeout(this.loadTimer);
      this.setStatus({ state: "error", reason: "wasm", message });
    }
  }

  /** Запасная цепочка без worklet: моно → усиление → лимитер (−3 дБ, 20:1). */
  private buildFallback(ctx: AudioContext, destination: MediaStreamAudioDestinationNode): void {
    const gain = ctx.createGain();
    gain.channelCount = 1;
    gain.channelCountMode = "explicit";
    gain.channelInterpretation = "speakers";
    gain.gain.value = this.settings.gain;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.1;
    gain.connect(limiter).connect(destination);
    this.fallback = { gain, limiter };
    if (this.meterListeners.size > 0) this.startFallbackMeter();
  }

  private connectSource(track: MediaStreamTrack): void {
    const ctx = this.ctx;
    const input = this.voice?.node ?? this.fallback?.gain;
    if (!ctx || !input) return;
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    this.source?.disconnect();
    this.source = source;
    source.connect(input);
  }

  // ---------------------------------------------------------------- события

  private setStatus(patch: Partial<MicStatus>): void {
    const prev = this.statusValue;
    const next: MicStatus = { ...prev, ...patch };
    if (
      next.state === prev.state &&
      next.reason === prev.reason &&
      next.message === prev.message &&
      next.blocked === prev.blocked
    ) {
      return;
    }
    this.statusValue = Object.freeze(next);
    for (const cb of this.statusListeners) cb(this.statusValue);
    this.notifyNs(false);
  }

  /** Фактическое состояние шумодава: включён и не сломан. */
  private nsActual(): boolean {
    return this.settings.noiseSuppression && this.statusValue.state !== "error";
  }

  /** Сообщить фактическое состояние шумодава (force — даже если не изменилось). */
  private notifyNs(force: boolean): void {
    if (this.statusValue.state === "idle" && !force) return;
    const ns = this.nsActual();
    if (!force && ns === this.lastNs) return;
    this.lastNs = ns;
    this.onNoiseSuppressionChange?.(ns);
  }

  private emitGate(open: boolean): void {
    this.gateOpen = open;
    for (const cb of this.gateListeners) cb(open);
  }

  private emitMeter(meter: VoiceMeter): void {
    for (const cb of this.meterListeners) cb(meter);
  }

  private applyMeter(on: boolean): void {
    this.voice?.setMeter(on);
    if (this.fallback) {
      if (on) this.startFallbackMeter();
      else this.stopFallbackMeter();
    }
  }

  /** Уровень на выходе запасной цепочки — без worklet все уровни одинаковые (после усиления). */
  private startFallbackMeter(): void {
    const fb = this.fallback;
    if (!fb || this.meterTimer) return;
    const analyser = (fb.analyser ??= fb.limiter.context.createAnalyser());
    fb.limiter.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    this.meterTimer = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const db = sum > 0 ? 10 * Math.log10(sum / buf.length) : -100;
      this.emitMeter({
        rawDb: db,
        levelDb: db,
        outDb: db,
        vad: NaN,
        open: true,
        thresholdDb: NaN,
        noiseDb: NaN,
        voiceDb: NaN,
        agcDb: 0,
        limiterDb: fb.limiter.reduction,
        frameMs: NaN,
      });
    }, FALLBACK_METER_MS);
  }

  private stopFallbackMeter(): void {
    // Анализатор подключён ровно пока идёт опрос: disconnect неподключённого бросает.
    if (!this.meterTimer) return;
    clearInterval(this.meterTimer);
    this.meterTimer = undefined;
    if (this.fallback?.analyser) this.fallback.limiter.disconnect(this.fallback.analyser);
  }
}

function openContext(sampleRate: number | undefined): AudioContext {
  if (sampleRate !== undefined) {
    try {
      return new AudioContext({ sampleRate, latencyHint: "interactive" });
    } catch {
      // браузер не умеет заданную частоту — берём системную (без RNNoise)
    }
  }
  return new AudioContext({ latencyHint: "interactive" });
}

function deviceOf(track: MediaStreamTrack): string | undefined {
  return track.getSettings?.().deviceId;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

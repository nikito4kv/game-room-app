/**
 * AudioWorklet «voice-processor» — вся обработка своего микрофона в аудиопотоке
 * браузера (отдельно от интерфейса). Собирается esbuild'ом в
 * public/audio/voice-processor.js (scripts/build-audio.mjs) и грузится через
 * audioWorklet.addModule — мимо бандлера Next.
 *
 * Логика — в dsp/pipeline.ts (её же гоняет офлайн-оценка), здесь только обвязка:
 * блоки 128 ↔ кадры 480, загрузка RNNoise, сообщения через port.
 *
 * Пока wasm грузится или если он не загрузился, звук идёт дальше без шумодава
 * (ФВЧ, порог по уровню, усиление, лимитер) — тишины в эфире не бывает, а
 * основной поток узнаёт правду из статуса.
 */
import { Reframer } from "./dsp/reframer";
import { VoicePipeline } from "./dsp/pipeline";
import { createRnnoise } from "./dsp/rnnoise";
import {
  VOICE_FRAME,
  VOICE_PROCESSOR_NAME,
  VOICE_SAMPLE_RATE,
  type FromWorklet,
  type ToWorklet,
  type VoiceProcessorInit,
} from "./protocol";

/** Глобалы AudioWorkletGlobalScope (в lib.dom их нет — и не нужно, чтобы не засорять страницу). */
type WorkletScope = {
  AudioWorkletProcessor: new () => { readonly port: MessagePort };
  registerProcessor(name: string, processor: unknown): void;
  sampleRate: number;
  performance?: { now(): number };
};
const scope = globalThis as unknown as WorkletScope;

/** Размер блока, которым браузер зовёт process(). */
const RENDER_QUANTUM = 128;
/** Метрики — раз в 3 кадра по 10 мс (≈33 раза в секунду) и только пока UI подписан. */
const METER_EVERY_FRAMES = 3;
/** Сглаживание времени кадра: ≈100 кадров (1 с). */
const FRAME_TIME_ALPHA = 0.01;

class VoiceProcessor extends scope.AudioWorkletProcessor {
  private readonly pipeline: VoicePipeline;
  private readonly reframer: Reframer;
  private destroyed = false;
  private meterOn = false;
  private meterLeft = METER_EVERY_FRAMES;
  // Время обработки кадра — скользящее среднее (≈1 с). Только если в этом браузере
  // у worklet есть performance.now(): у Chrome его нет, а Date.now() (шаг 1 мс)
  // врёт в разы — вызовы идут пачками с почти постоянной фазой к тикам часов.
  // Тогда время кадра меряет стенд (scripts/audio-eval/bench.mjs).
  private readonly now: (() => number) | null;
  private frameMs = NaN;

  constructor(options: { processorOptions?: VoiceProcessorInit }) {
    super();
    this.pipeline = new VoicePipeline(scope.sampleRate, options.processorOptions?.settings ?? {});
    this.pipeline.onGateChange = (open) => this.post({ type: "gate", open });
    this.reframer = new Reframer(VOICE_FRAME, RENDER_QUANTUM, (input, output) => this.processFrame(input, output));
    const perf = scope.performance;
    this.now = perf && typeof perf.now === "function" ? () => perf.now() : null;
    // onmessage (а не addEventListener) сам запускает порт — иначе сообщения,
    // включая «destroy», не доходят (баг готового worklet RNNoise).
    this.port.onmessage = (e: MessageEvent<ToWorklet>) => this.onMessage(e.data);
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.destroyed) return false;
    const output = outputs[0]?.[0];
    if (output) this.reframer.push(inputs[0]?.[0], output);
    return true;
  }

  private processFrame(input: Float32Array, output: Float32Array): void {
    if (!this.meterOn) {
      this.pipeline.process(input, output);
      return;
    }
    if (this.now) {
      const t0 = this.now();
      this.pipeline.process(input, output);
      const dt = this.now() - t0;
      this.frameMs = Number.isNaN(this.frameMs) ? dt : this.frameMs + (dt - this.frameMs) * FRAME_TIME_ALPHA;
    } else {
      this.pipeline.process(input, output);
    }
    if (--this.meterLeft <= 0) {
      this.meterLeft = METER_EVERY_FRAMES;
      this.post({ type: "meter", meter: this.pipeline.takeMeter(this.frameMs) });
    }
  }

  private onMessage(msg: ToWorklet): void {
    switch (msg.type) {
      case "settings":
        this.pipeline.update(msg.settings);
        break;
      case "wasm":
        void this.loadRnnoise(msg.bytes);
        break;
      case "meter":
        this.meterOn = msg.on;
        this.meterLeft = METER_EVERY_FRAMES;
        this.frameMs = NaN;
        this.pipeline.takeMeter(); // сбросить накопленное, чтобы первый снимок был свежим
        break;
      case "calibrate":
        this.pipeline.calibrate(msg.frames, (result) => this.post({ type: "calibration", id: msg.id, result }));
        break;
      case "reset":
        this.pipeline.gate.resetLearning();
        break;
      case "seed":
        this.pipeline.gate.seed(msg.voiceDb, msg.noiseDb);
        break;
      case "destroy":
        this.destroyed = true;
        this.pipeline.setDenoiser(null); // освобождает память RNNoise
        this.port.onmessage = null;
        break;
    }
  }

  private async loadRnnoise(bytes: ArrayBuffer): Promise<void> {
    if (scope.sampleRate !== VOICE_SAMPLE_RATE) {
      this.post({ type: "status", status: "error", message: `RNNoise работает только на 48 кГц (контекст ${scope.sampleRate})` });
      return;
    }
    this.post({ type: "status", status: "loading" });
    try {
      const denoiser = await createRnnoise(bytes);
      if (this.destroyed) {
        denoiser.destroy();
        return;
      }
      this.pipeline.setDenoiser(denoiser);
      this.post({ type: "status", status: "ready" });
    } catch (e) {
      this.post({ type: "status", status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  private post(msg: FromWorklet): void {
    if (!this.destroyed) this.port.postMessage(msg);
  }
}

scope.registerProcessor(VOICE_PROCESSOR_NAME, VoiceProcessor);

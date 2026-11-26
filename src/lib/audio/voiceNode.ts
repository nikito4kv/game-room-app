/**
 * Узел обработки голоса (AudioWorklet «voice-processor», src/lib/audio/worklet) со
 * стороны страницы: загрузка модуля worklet и wasm RNNoise, обмен сообщениями.
 *
 * Файлы лежат в public/audio (scripts/build-audio.mjs) и грузятся по URL: worklet
 * исполняется в своём аудиопотоке мимо бандлера, wasm — тоже по URL.
 */
import {
  VOICE_PROCESSOR_NAME,
  type CalibrationResult,
  type FromWorklet,
  type ToWorklet,
  type VoiceMeter,
  type VoiceSettings,
  type WorkletStatus,
} from "./worklet/protocol";

const BASE = "/audio";
export const VOICE_WORKLET_URL = `${BASE}/voice-processor.js`;
const RNNOISE_URL = `${BASE}/rnnoise.wasm`;
const RNNOISE_SIMD_URL = `${BASE}/rnnoise_simd.wasm`;

/** Крошечный модуль с инструкцией SIMD (как в wasm-feature-detect): валиден — браузер умеет SIMD. */
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
]);

export function supportsWasmSimd(): boolean {
  try {
    return WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}

let wasmPromise: Promise<ArrayBuffer> | null = null;

/**
 * wasm RNNoise — сборка с SIMD, если браузер её понимает (≈25 % быстрее).
 * Грузится один раз на вкладку; отказ НЕ кэшируется — следующая попытка
 * скачает заново (один сетевой сбой не должен выключать шумодав до перезагрузки).
 */
export function loadRnnoiseWasm(): Promise<ArrayBuffer> {
  wasmPromise ??= fetch(supportsWasmSimd() ? RNNOISE_SIMD_URL : RNNOISE_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`RNNoise: HTTP ${res.status}`);
      return res.arrayBuffer();
    })
    .catch((e: unknown) => {
      wasmPromise = null;
      throw e;
    });
  return wasmPromise;
}

/** Калибровка невозможна: обработки нет (не загрузилась) или её остановили. */
export const CALIBRATION_UNAVAILABLE: CalibrationResult = {
  ok: false,
  reason: "unavailable",
  voiceDb: NaN,
  noiseDb: NaN,
  thresholdDb: NaN,
  speechMs: 0,
};

export type VoiceNodeHandlers = {
  onStatus(status: WorkletStatus, message?: string): void;
  onGate(open: boolean): void;
  onMeter(meter: VoiceMeter): void;
};

export class VoiceNode {
  readonly node: AudioWorkletNode;
  private readonly pending = new Map<number, (result: CalibrationResult) => void>();
  private nextId = 1;

  /** Модуль worklet должен быть уже загружен в контекст (VoiceNode.loadModule). */
  constructor(ctx: AudioContext, settings: VoiceSettings, private readonly handlers: VoiceNodeHandlers) {
    this.node = new AudioWorkletNode(ctx, VOICE_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      // Узел сам сводит вход в моно ((L+R)/2): голос — одна дорожка, без «одного уха».
      channelCount: 1,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
      processorOptions: { settings },
    });
    this.node.port.onmessage = (e: MessageEvent<FromWorklet>) => this.onMessage(e.data);
  }

  static loadModule(ctx: AudioContext): Promise<void> {
    return ctx.audioWorklet.addModule(VOICE_WORKLET_URL);
  }

  provideWasm(bytes: ArrayBuffer): void {
    this.send({ type: "wasm", bytes });
  }

  update(settings: Partial<VoiceSettings>): void {
    this.send({ type: "settings", settings });
  }

  setMeter(on: boolean): void {
    this.send({ type: "meter", on });
  }

  resetLearning(): void {
    this.send({ type: "reset" });
  }

  seed(voiceDb: number, noiseDb: number): void {
    this.send({ type: "seed", voiceDb, noiseDb });
  }

  calibrate(frames: number): Promise<CalibrationResult> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.send({ type: "calibrate", id, frames });
    });
  }

  destroy(): void {
    this.send({ type: "destroy" });
    this.node.port.onmessage = null;
    this.node.disconnect();
    // Незавершённые калибровки не должны висеть вечно.
    for (const resolve of this.pending.values()) resolve(CALIBRATION_UNAVAILABLE);
    this.pending.clear();
  }

  private send(msg: ToWorklet): void {
    this.node.port.postMessage(msg);
  }

  private onMessage(msg: FromWorklet): void {
    switch (msg.type) {
      case "status":
        this.handlers.onStatus(msg.status, msg.message);
        break;
      case "gate":
        this.handlers.onGate(msg.open);
        break;
      case "meter":
        this.handlers.onMeter(msg.meter);
        break;
      case "calibration":
        this.pending.get(msg.id)?.(msg.result);
        this.pending.delete(msg.id);
        break;
    }
  }
}

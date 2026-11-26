import { VOICE_FRAME } from "../protocol";
import type { Denoiser } from "./pipeline";

/**
 * Свой загрузчик RNNoise (Xiph, BSD-3) из wasm-сборки @shiguredo/rnnoise-wasm,
 * которую поставляет @sapphi-red/web-noise-suppressor (0.4.1: rnnoise.wasm и
 * rnnoise_simd.wasm — настоящий SIMD). Обвязка emscripten (~100 КБ JS) не нужна:
 * модулю нужны всего три функции из «env», а нам — сырой rnnoise_process_frame,
 * который кроме очищенного звука возвращает вероятность речи (VAD). Готовый
 * worklet пакета эту VAD выбрасывает.
 *
 * Работает и в AudioWorklet, и в Node (офлайн-оценка): нет ни DOM, ни fetch.
 */
type RnnoiseExports = {
  memory: WebAssembly.Memory;
  __wasm_call_ctors(): void;
  emscripten_stack_init?: () => void;
  rnnoise_get_frame_size(): number;
  rnnoise_create(model: number): number;
  rnnoise_destroy(state: number): void;
  rnnoise_process_frame(state: number, out: number, input: number): number;
  malloc(size: number): number;
  free(ptr: number): void;
};

/** RNNoise ждёт отсчёты в шкале int16, а Web Audio даёт float ±1. */
const SCALE = 32768;

export async function createRnnoise(wasm: BufferSource | WebAssembly.Module): Promise<Denoiser> {
  // Память модуля известна только после создания, а функции «env» нужны до него.
  const linked: { memory?: WebAssembly.Memory } = {};
  const env = {
    emscripten_memcpy_big(dest: number, src: number, num: number) {
      new Uint8Array(linked.memory!.buffer).copyWithin(dest, src, src + num);
    },
    emscripten_resize_heap(requested: number) {
      const mem = linked.memory!;
      try {
        mem.grow(Math.ceil((requested - mem.buffer.byteLength) / 65536));
        return 1;
      } catch {
        return 0;
      }
    },
    __assert_fail() {
      throw new Error("RNNoise: внутренняя проверка не прошла");
    },
  };
  const instance =
    wasm instanceof WebAssembly.Module
      ? await WebAssembly.instantiate(wasm, { env })
      : (await WebAssembly.instantiate(wasm, { env })).instance;
  const ex = instance.exports as unknown as RnnoiseExports;
  const memory = ex.memory;
  linked.memory = memory;
  ex.emscripten_stack_init?.();
  ex.__wasm_call_ctors();

  const frameSize = ex.rnnoise_get_frame_size();
  if (frameSize !== VOICE_FRAME) throw new Error(`RNNoise: кадр ${frameSize}, ожидали ${VOICE_FRAME}`);
  const state = ex.rnnoise_create(0);
  const inPtr = ex.malloc(VOICE_FRAME * 4);
  const outPtr = ex.malloc(VOICE_FRAME * 4);
  if (!state || !inPtr || !outPtr) throw new Error("RNNoise: не хватило памяти");

  // Вид на память пересоздаём, только если она выросла (тогда старый буфер «отцепляется»).
  let heap = new Float32Array(memory.buffer);
  let destroyed = false;
  return {
    processFrame(frame: Float32Array): number {
      if (destroyed) return NaN;
      if (heap.buffer !== memory.buffer) heap = new Float32Array(memory.buffer);
      const inBase = inPtr >> 2;
      const outBase = outPtr >> 2;
      for (let i = 0; i < VOICE_FRAME; i++) heap[inBase + i] = frame[i] * SCALE;
      const vad = ex.rnnoise_process_frame(state, outPtr, inPtr);
      if (heap.buffer !== memory.buffer) heap = new Float32Array(memory.buffer);
      for (let i = 0; i < VOICE_FRAME; i++) frame[i] = heap[outBase + i] / SCALE;
      return vad;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      ex.rnnoise_destroy(state);
      ex.free(inPtr);
      ex.free(outPtr);
    },
  };
}

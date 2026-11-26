// GTCRN (@sapphi-red/web-noise-suppressor 0.4.1, gtcrn.wasm) как шумодав для
// офлайн-сравнения с RNNoise. Модель ест кадры по 768 сэмплов на 48 кГц (внутри —
// 16 кГц), поэтому здесь свой переходник 480 ↔ 768. VAD модель не даёт (NaN).
//
// Импорты/экспорты wasm минифицированы emscripten'ом; соответствие взято из
// обвязки пакета (@sapphi-red/gtcrn-wasm): c — память, d — конструкторы,
// e — create, g — destroy, j — process_48k, k — malloc, f — free.
const FRAME_48K = 768;

export async function createGtcrnDenoiser(wasmBytes) {
  let memory;
  const imports = {
    a: {
      a: () => {
        throw new Error("GTCRN: внутренняя проверка не прошла");
      },
      b: (requested) => {
        try {
          memory.grow(Math.ceil((requested - memory.buffer.byteLength) / 65536));
          return 1;
        } catch {
          return 0;
        }
      },
    },
  };
  const { instance } = await WebAssembly.instantiate(wasmBytes, imports);
  const ex = instance.exports;
  memory = ex.c;
  ex.d();
  const state = ex.e();
  const inPtr = ex.k(FRAME_48K * 4);
  const outPtr = ex.k(FRAME_48K * 4);

  // Переходник: копим вход до 768, отдаём по 480 с запасом 672 (минимум для 480/768).
  const inFifo = new Float32Array(FRAME_48K * 2);
  let inCount = 0;
  const ring = new Float32Array(4096);
  let ringRead = 0;
  let ringCount = 672;
  return {
    processFrame(frame) {
      inFifo.set(frame, inCount);
      inCount += frame.length;
      while (inCount >= FRAME_48K) {
        const heap = new Float32Array(memory.buffer);
        heap.set(inFifo.subarray(0, FRAME_48K), inPtr >> 2);
        ex.j(state, inPtr, outPtr);
        const res = new Float32Array(memory.buffer).subarray(outPtr >> 2, (outPtr >> 2) + FRAME_48K);
        for (let i = 0; i < FRAME_48K; i++) ring[(ringRead + ringCount + i) % ring.length] = res[i];
        ringCount += FRAME_48K;
        inFifo.copyWithin(0, FRAME_48K, inCount);
        inCount -= FRAME_48K;
      }
      for (let i = 0; i < frame.length; i++) {
        frame[i] = ring[ringRead];
        ringRead = (ringRead + 1) % ring.length;
      }
      ringCount -= frame.length;
      return NaN;
    },
    destroy() {
      ex.f(inPtr);
      ex.f(outPtr);
      ex.g(state);
    },
  };
}

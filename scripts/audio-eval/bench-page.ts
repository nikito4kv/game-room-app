/**
 * Страница-стенд для живого браузера (scripts/audio-eval/bench.mjs): настоящий
 * MicProcessor на фейковом микрофоне Chrome (речь из .dev-stack/speech.wav).
 * Пишет выход обработки и сырой микрофон, по ходу дёргает настройки и калибровку,
 * результат кладёт в window.__bench.
 */
import { MicProcessor, type MicStatus, type VoiceMeter } from "../../src/lib/audio/micProcessor";
import { loadRnnoiseWasm } from "../../src/lib/audio/voiceNode";
import { micTestConstraints } from "../../src/lib/audio/voiceOptions";
import { VoicePipeline } from "../../src/lib/audio/worklet/dsp/pipeline";
import { createRnnoise } from "../../src/lib/audio/worklet/dsp/rnnoise";

type Bench = {
  statuses: (MicStatus & { t: number })[];
  gates: { t: number; open: boolean }[];
  meters: (VoiceMeter & { t: number })[];
  ns: boolean[];
  calibration?: unknown;
  out?: Float32Array;
  raw?: Float32Array;
  /** Та же цепочка в Chrome на основном потоке с точным таймером: мс на кадр 10 мс. */
  mainThread?: { meanMs: number; p99Ms: number; frames: number };
  done: boolean;
  error?: string;
};

/**
 * Замер цепочки (тот же код и тот же wasm, что в worklet) на основном потоке:
 * в AudioWorklet у Chrome нет performance.now(), а здесь он точный.
 */
async function timeChain(): Promise<Bench["mainThread"]> {
  const p = new VoicePipeline(48000, { autoGain: true });
  p.setDenoiser(await createRnnoise(await loadRnnoiseWasm()));
  const frame = new Float32Array(480);
  const out = new Float32Array(480);
  const times: number[] = [];
  for (let k = 0; k < 3500; k++) {
    // «речь» с паузами: гармоники 150 Гц + шум
    const on = k % 120 < 80;
    for (let i = 0; i < 480; i++) {
      const t = (k * 480 + i) / 48000;
      frame[i] = (on ? 0.1 * Math.sin(2 * Math.PI * 150 * t) + 0.05 * Math.sin(2 * Math.PI * 450 * t) : 0) + (Math.random() - 0.5) * 0.002;
    }
    const t0 = performance.now();
    p.process(frame, out);
    if (k >= 500) times.push(performance.now() - t0); // первые 5 с — прогрев JIT
  }
  times.sort((a, b) => a - b);
  return {
    meanMs: times.reduce((a, b) => a + b, 0) / times.length,
    p99Ms: times[Math.floor(times.length * 0.99)],
    frames: times.length,
  };
}

const DURATION_MS = 24000;
const bench: Bench = { statuses: [], gates: [], meters: [], ns: [], done: false };
(window as unknown as { __bench: Bench }).__bench = bench;
const t0 = performance.now();
const now = () => Math.round(performance.now() - t0);

/** Записывает дорожку целиком через AudioWorklet-«отвод» (tap.js). */
async function recorder(ctx: AudioContext, track: MediaStreamTrack) {
  const chunks: Float32Array[] = [];
  const src = ctx.createMediaStreamSource(new MediaStream([track]));
  const tap = new AudioWorkletNode(ctx, "tap", { numberOfOutputs: 0, channelCount: 1, channelCountMode: "explicit" });
  tap.port.onmessage = (e: MessageEvent<Float32Array>) => chunks.push(e.data);
  src.connect(tap);
  return () => {
    src.disconnect();
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const all = new Float32Array(total);
    let at = 0;
    for (const c of chunks) {
      all.set(c, at);
      at += c.length;
    }
    return all;
  };
}

async function main() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: micTestConstraints(null) });
  const track = stream.getAudioTracks()[0];
  const mp = new MicProcessor(1, true, (on) => bench.ns.push(on));
  mp.onStatus((s) => bench.statuses.push({ t: now(), ...s }));
  mp.onGateChange((open) => bench.gates.push({ t: now(), open }));
  mp.subscribeMeter((m) => bench.meters.push({ t: now(), ...m }));
  await mp.start(track);

  const ctx = new AudioContext({ sampleRate: 48000 });
  await ctx.audioWorklet.addModule("tap.js");
  const stopOut = await recorder(ctx, mp.processedTrack!);
  const stopRaw = await recorder(ctx, track);

  // Сценарий: калибровка, переключения шумодава/усиления/режимов на ходу.
  const at = (ms: number, fn: () => unknown) =>
    new Promise<void>((resolve) => setTimeout(() => void Promise.resolve(fn()).then(() => resolve()), ms));
  await Promise.all([
    at(3000, async () => {
      bench.calibration = await mp.calibrate(3000);
    }),
    at(9000, () => mp.setNoiseSuppression(false)),
    at(11000, () => mp.setNoiseSuppression(true)),
    at(13000, () => mp.setGain(2)),
    at(15000, () => mp.setGain(1)),
    at(17000, () => mp.setGateMode("off")),
    at(19000, () => mp.setGateMode("auto")),
    at(DURATION_MS, () => {}),
  ]);
  bench.out = stopOut();
  bench.raw = stopRaw();
  await mp.destroy();
  stream.getTracks().forEach((t) => t.stop());
  await ctx.close();
  bench.mainThread = await timeChain();
  bench.done = true;
}

main().catch((e: unknown) => {
  bench.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  bench.done = true;
});

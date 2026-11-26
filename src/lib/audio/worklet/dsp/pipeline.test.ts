import { describe, expect, it } from "vitest";
import { VOICE_FRAME } from "../protocol";
import { meanSquare } from "./db";
import { VoicePipeline, type Denoiser } from "./pipeline";

const SR = 48000;
const F = VOICE_FRAME;

/** Шумодав-заглушка: задержка ровно на кадр (как у RNNoise), VAD — по громкости. */
function fakeDenoiser(): Denoiser {
  let prev = new Float32Array(F);
  return {
    processFrame(frame) {
      const cur = Float32Array.from(frame);
      frame.set(prev);
      prev = cur;
      return meanSquare(cur) > 1e-4 ? 0.98 : 0.02;
    },
    destroy() {},
  };
}

/** Прогоняет сигнал кадрами, возвращает выход той же длины. */
function run(p: VoicePipeline, x: Float32Array): Float32Array {
  const out = new Float32Array(x.length);
  const o = new Float32Array(F);
  for (let k = 0; k + F <= x.length; k += F) {
    p.process(x.subarray(k, k + F), o);
    out.set(o, k);
  }
  return out;
}

function tone(n: number, amp: number, f = 220): Float32Array {
  return Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / SR));
}

describe("VoicePipeline", () => {
  it("задержка = кадр шумодава + 3 кадра упреждения + 1 мс лимитера", () => {
    const p = new VoicePipeline(SR);
    expect(p.latency).toBe(4 * F + 48);
  });

  it("тишина на выходе — честные нули (порог закрыт)", () => {
    const p = new VoicePipeline(SR, { autoGain: false });
    p.setDenoiser(fakeDenoiser());
    const y = run(p, new Float32Array(F * 100).map(() => (Math.random() - 0.5) * 1e-4));
    expect(y.every((v) => v === 0)).toBe(true);
  });

  it("речь проходит без изменения громкости и начинается без потерь (упреждение)", () => {
    const p = new VoicePipeline(SR, { autoGain: false });
    p.setDenoiser(fakeDenoiser());
    const x = new Float32Array(F * 200);
    x.set(tone(F * 100, 0.1), F * 60);
    const y = run(p, x);
    const lat = p.latency;
    // огибающая открыта уже к началу тона
    const start = F * 60 + lat;
    expect(Math.abs(y[start + 10])).toBeGreaterThan(0);
    const inPow = meanSquare(x, F * 80, F * 150);
    const outPow = meanSquare(y, F * 80 + lat, F * 150 + lat);
    expect(10 * Math.log10(outPow / inPow)).toBeCloseTo(0, 0);
  });

  it("событие порога приходит раньше, чем звук дойдёт до выхода, и после удержания — закрытие", () => {
    const p = new VoicePipeline(SR, { autoGain: false });
    p.setDenoiser(fakeDenoiser());
    const events: [number, boolean][] = [];
    let frame = 0;
    p.onGateChange = (open) => events.push([frame, open]);
    const x = new Float32Array(F * 200);
    x.set(tone(F * 50, 0.1), F * 60);
    const o = new Float32Array(F);
    for (frame = 0; frame < 200; frame++) p.process(x.subarray(frame * F, (frame + 1) * F), o);
    expect(events[0][1]).toBe(true);
    expect(events[0][0]).toBeLessThanOrEqual(62);
    expect(events[1][1]).toBe(false);
    expect(events[1][0] - 110).toBeGreaterThanOrEqual(20); // удержание 200 мс
  });

  it("выключение шумодава и смена усиления — плавно, без щелчков", () => {
    const p = new VoicePipeline(SR, { gateMode: "off", autoGain: false });
    p.setDenoiser(fakeDenoiser());
    const x = tone(F * 300, 0.2, 100);
    const y = new Float32Array(x.length);
    const o = new Float32Array(F);
    for (let k = 0; k < 300; k++) {
      if (k === 100) p.update({ noiseSuppression: false });
      if (k === 200) p.update({ gain: 2 });
      p.process(x.subarray(k * F, (k + 1) * F), o);
      y.set(o, k * F);
    }
    let maxJump = 0;
    for (let i = F * 20; i < y.length; i++) maxJump = Math.max(maxJump, Math.abs(y[i] - y[i - 1]));
    // у синуса 100 Гц амплитуды 0,4 соседние сэмплы отличаются максимум на ~0,005
    expect(maxJump).toBeLessThan(0.007);
  });

  it("усиление 200 % на громком голосе не вылезает за −1 дБFS", () => {
    const p = new VoicePipeline(SR, { gateMode: "off", autoGain: false, gain: 2 });
    p.setDenoiser(fakeDenoiser());
    const y = run(p, tone(F * 200, 0.9));
    let peak = 0;
    for (const v of y) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThanOrEqual(Math.pow(10, -1 / 20) + 1e-6);
  });

  it("NaN на входе не отравляет цепочку", () => {
    const p = new VoicePipeline(SR, { gateMode: "off" });
    p.setDenoiser(fakeDenoiser());
    const bad = new Float32Array(F).fill(NaN);
    const o = new Float32Array(F);
    p.process(bad, o);
    const y = run(p, tone(F * 50, 0.1));
    expect(y.every(Number.isFinite)).toBe(true);
    expect(o.every(Number.isFinite)).toBe(true);
  });

  it("без шумодава работает (порог по уровню), метрики и калибровка доступны", async () => {
    const p = new VoicePipeline(SR, { autoGain: false });
    const x = new Float32Array(F * 400);
    for (let k = 0; k < 400; k++) if (k % 50 < 35) x.set(tone(F, 0.1), k * F);
    const result = await new Promise<import("./calibration").CalibrationResult>((resolve) => {
      p.calibrate(300, resolve);
      run(p, x);
    });
    expect(result.ok).toBe(true);
    expect(result.voiceDb).toBeGreaterThan(-25);
    // калибровка засеяла оценку, дальше она лишь уточняется
    expect(p.gate.voiceDb).toBeCloseTo(result.voiceDb, 0);
    const m = p.takeMeter(0.2);
    expect(Number.isFinite(m.rawDb)).toBe(true);
    expect(m.frameMs).toBe(0.2);
    expect(m.vad).toBeNaN();
  });
});

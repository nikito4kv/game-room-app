import { describe, expect, it } from "vitest";
import { LookaheadLimiter } from "./limiter";

const SR = 48000;
const CEIL = Math.pow(10, -1 / 20);

function sine(n: number, amp: number, f = 220): Float32Array {
  return Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / SR));
}

describe("LookaheadLimiter", () => {
  it("тихий сигнал проходит без изменений (с задержкой упреждения)", () => {
    const lim = new LookaheadLimiter(SR);
    const x = sine(4800, 0.5);
    const y = Float32Array.from(x);
    lim.process(y);
    for (let i = lim.latency; i < x.length; i++) expect(y[i]).toBeCloseTo(x[i - lim.latency], 6);
    expect(lim.takeReductionDb()).toBe(0);
  });

  it("усиление 200 % не вылезает за −1 дБFS, без перерегулирования", () => {
    const lim = new LookaheadLimiter(SR);
    const x = sine(SR, 2);
    const y = Float32Array.from(x);
    // обрабатываем кусками, как в цепочке
    for (let k = 0; k < y.length; k += 480) lim.process(y.subarray(k, k + 480));
    let peak = 0;
    for (const v of y) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThanOrEqual(CEIL + 1e-6);
    expect(peak).toBeGreaterThan(0.8);
    expect(lim.takeReductionDb()).toBeLessThan(-6);
  });

  it("резкий пик гасится заранее плавной рампой, а не скачком", () => {
    const lim = new LookaheadLimiter(SR);
    const x = new Float32Array(2000).fill(0.5);
    for (let i = 1000; i < 1100; i++) x[i] = 1.6;
    const y = Float32Array.from(x);
    lim.process(y);
    // множитель = выход / задержанный вход
    let maxStep = 0;
    let prev = 1;
    for (let i = lim.latency; i < y.length; i++) {
      const g = y[i] / x[i - lim.latency];
      maxStep = Math.max(maxStep, Math.abs(g - prev));
      prev = g;
    }
    // ступенька 1 → 0,56 размазана на ≥ 48 сэмплов
    expect(maxStep).toBeLessThan(0.02);
    for (const v of y) expect(Math.abs(v)).toBeLessThanOrEqual(CEIL + 1e-6);
  });
});

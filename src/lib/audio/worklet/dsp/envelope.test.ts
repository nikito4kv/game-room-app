import { describe, expect, it } from "vitest";
import { GateEnvelope } from "./envelope";

const SR = 48000;

function run(env: GateEnvelope, target: boolean, samples: number): Float32Array {
  const buf = new Float32Array(samples).fill(1);
  env.apply(buf, target);
  return buf;
}

function maxStep(a: Float32Array, start = 0): number {
  let m = start;
  for (let i = 1; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - a[i - 1]));
  return m;
}

describe("GateEnvelope", () => {
  it("атака — линейно до 1 за 5 мс, без скачков", () => {
    const env = new GateEnvelope(SR, 5, 120);
    const g = run(env, true, 480);
    expect(g[0]).toBeGreaterThan(0);
    expect(g[238]).toBeLessThan(1);
    expect(g[239]).toBeCloseTo(1, 6);
    // буфер float32 — допуск на его округление
    expect(maxStep(g, g[0])).toBeLessThanOrEqual(1 / 240 + 1e-6);
  });

  it("отпускание — плавно, за 120 мс до −40 дБ, затем честный ноль", () => {
    const env = new GateEnvelope(SR, 5, 120);
    run(env, true, 480);
    const g = run(env, false, 0.3 * SR);
    expect(g[Math.round(0.12 * SR) - 1]).toBeCloseTo(0.01, 3);
    expect(g[g.length - 1]).toBe(0);
    expect(maxStep(g, 1 - g[0])).toBeLessThan(0.001);
  });

  it("смена направления посреди атаки не даёт скачка", () => {
    const env = new GateEnvelope(SR, 5, 120);
    const a = run(env, true, 100);
    const b = run(env, false, 100);
    expect(Math.abs(b[0] - a[99])).toBeLessThan(0.001);
  });
});

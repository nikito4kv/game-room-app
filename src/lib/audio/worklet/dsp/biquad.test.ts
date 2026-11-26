import { describe, expect, it } from "vitest";
import { Biquad } from "./biquad";
import { rmsDb } from "./db";

const SR = 48000;

/** Уровень синуса частоты f после фильтра (установившийся режим), дБ относительно входа. */
function responseDb(f: number): number {
  const filter = Biquad.highpass(SR, 80);
  const buf = new Float32Array(SR); // 1 с
  for (let i = 0; i < buf.length; i++) buf[i] = Math.sin((2 * Math.PI * f * i) / SR);
  const inDb = rmsDb(buf, SR / 2);
  filter.process(buf);
  return rmsDb(buf, SR / 2) - inDb;
}

describe("Biquad.highpass 80 Гц", () => {
  it("пропускает голос и режет гул и стук", () => {
    expect(responseDb(1000)).toBeCloseTo(0, 1);
    expect(responseDb(300)).toBeGreaterThan(-0.3);
    expect(responseDb(80)).toBeCloseTo(-3, 0);
    expect(responseDb(50)).toBeLessThan(-8);
    expect(responseDb(20)).toBeLessThan(-23);
  });

  it("состояние переживает границы буферов (без щелчка на стыке)", () => {
    const whole = Biquad.highpass(SR, 80);
    const parts = Biquad.highpass(SR, 80);
    const a = new Float32Array(960).map((_, i) => Math.sin(i / 7));
    const b = Float32Array.from(a);
    whole.process(a);
    parts.process(b.subarray(0, 480));
    parts.process(b.subarray(480));
    for (let i = 0; i < a.length; i++) expect(b[i]).toBeCloseTo(a[i], 6);
  });
});

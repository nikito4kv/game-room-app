import { describe, expect, it } from "vitest";
import { Reframer } from "./reframer";

describe("Reframer", () => {
  it("минимальная задержка для 480/128 — 448 сэмплов (9,3 мс)", () => {
    expect(Reframer.latencyFor(480, 128)).toBe(448);
    // кадр кратен блоку: всё равно ждём, пока наберётся кадр
    expect(Reframer.latencyFor(512, 128)).toBe(384);
    expect(Reframer.latencyFor(768, 480)).toBe(672);
  });

  it("с обработкой «как есть» выход — это вход, сдвинутый ровно на latency, без пропусков", () => {
    const r = new Reframer(480, 128, (input, output) => output.set(input));
    const total = 128 * 60;
    const input = Float32Array.from({ length: total }, (_, i) => i + 1);
    const output = new Float32Array(total);
    for (let k = 0; k < total; k += 128) r.push(input.subarray(k, k + 128), output.subarray(k, k + 128));
    for (let i = 0; i < total; i++) expect(output[i]).toBe(i < r.latency ? 0 : input[i - r.latency]);
  });

  it("неподключённый вход считается тишиной", () => {
    const seen: number[] = [];
    const r = new Reframer(480, 128, (input, output) => {
      seen.push(Math.max(...input));
      output.set(input);
    });
    const out = new Float32Array(128);
    for (let k = 0; k < 8; k++) r.push(undefined, out);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((m) => m === 0)).toBe(true);
  });
});

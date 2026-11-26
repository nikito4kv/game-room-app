import { describe, expect, it } from "vitest";
import { analyzeCalibration, percentileOf } from "./calibration";

const RULES = { noiseMarginDb: 8, voiceMarginDb: 11, voicePercentile: 0.9, noisePercentile: 0.2 };

/** 3 с: фраза с паузами между словами. */
function phrase(voiceDb: number, pauseDb: number, vadKnown = true) {
  const levels: number[] = [];
  const vads: number[] = [];
  for (let i = 0; i < 300; i++) {
    const speech = i % 50 < 35;
    levels.push(speech ? voiceDb + ((i * 5) % 7) - 3 : pauseDb);
    vads.push(vadKnown ? (speech ? 0.95 : 0.05) : NaN);
  }
  return { levels, vads };
}

describe("analyzeCalibration", () => {
  it("фраза в гарнитуре: голос, фон и порог по правилу авто-режима", () => {
    const { levels, vads } = phrase(-22, -70);
    const r = analyzeCalibration(levels, vads, 10, RULES);
    expect(r.ok).toBe(true);
    expect(r.voiceDb).toBeGreaterThan(-22);
    expect(r.voiceDb).toBeLessThan(-18);
    expect(r.noiseDb).toBeCloseTo(-70, 5);
    expect(r.thresholdDb).toBeCloseTo(Math.max(r.noiseDb + 8, r.voiceDb - 11), 5);
    expect(r.speechMs).toBe(2100);
  });

  it("молчали — no-speech", () => {
    const r = analyzeCalibration(new Array(300).fill(-70), new Array(300).fill(0.02), 10, RULES);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no-speech");
  });

  it("голос почти не громче фона — noisy; еле слышно — too-quiet", () => {
    const noisy = phrase(-40, -46);
    expect(analyzeCalibration(noisy.levels, noisy.vads, 10, RULES).reason).toBe("noisy");
    const quiet = phrase(-66, -95);
    expect(analyzeCalibration(quiet.levels, quiet.vads, 10, RULES).reason).toBe("too-quiet");
  });

  it("без VAD речь определяется по уровню", () => {
    const { levels, vads } = phrase(-22, -70, false);
    const r = analyzeCalibration(levels, vads, 10, RULES);
    expect(r.ok).toBe(true);
    expect(r.voiceDb).toBeGreaterThan(-23);
  });

  it("percentileOf с интерполяцией", () => {
    expect(percentileOf([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentileOf([0, 10], 0.25)).toBe(2.5);
    expect(percentileOf([], 0.5)).toBeNaN();
  });
});

import { describe, expect, it } from "vitest";
import { VoiceAgc } from "./agc";

const FRAME_MS = 10;

function frames(agc: VoiceAgc, voiceDb: number, own: boolean, n: number, enabled = true): number {
  let g = 0;
  for (let i = 0; i < n; i++) g = agc.update(voiceDb, own, enabled);
  return g;
}

describe("VoiceAgc", () => {
  it("тянет к цели −18 дБFS по речи, прибавляя не быстрее 2 дБ/с", () => {
    const agc = new VoiceAgc(FRAME_MS);
    // голос: верхний процентиль −26 → средний ≈ −30 → нужно +12… но потолок +12
    expect(frames(agc, -26, true, 100)).toBeCloseTo(2, 5); // 1 с речи
    expect(frames(agc, -26, true, 500)).toBeCloseTo(12, 5);
    expect(frames(agc, -26, true, 500)).toBeCloseTo(12, 5); // потолок
  });

  it("цель достигается точно, если хватает запаса", () => {
    const agc = new VoiceAgc(FRAME_MS);
    expect(frames(agc, -20, true, 1000)).toBeCloseTo(-18 + 4 + 20, 5);
  });

  it("убавляет быстро (10 дБ/с) — громкий голос не оглушает", () => {
    const agc = new VoiceAgc(FRAME_MS);
    frames(agc, -30, true, 1000);
    expect(frames(agc, -6, true, 50)).toBeCloseTo(12 - 5, 5); // 0,5 с
    expect(frames(agc, -6, true, 200)).toBeCloseTo(-18 + 4 + 6, 5);
  });

  it("в паузах (не своя речь) и без оценки голоса стоит на месте", () => {
    const agc = new VoiceAgc(FRAME_MS);
    frames(agc, -26, true, 300);
    const g = agc.gainDb;
    expect(frames(agc, -40, false, 1000)).toBe(g);
    expect(frames(agc, NaN, true, 1000)).toBe(g);
  });

  it("выключенная возвращается к 0 дБ примерно за секунду", () => {
    const agc = new VoiceAgc(FRAME_MS);
    frames(agc, -30, true, 1000);
    expect(frames(agc, -30, false, 60, false)).toBeCloseTo(6, 5);
    expect(frames(agc, -30, false, 60, false)).toBe(0);
  });
});

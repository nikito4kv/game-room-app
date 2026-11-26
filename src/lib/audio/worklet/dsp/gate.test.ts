import { describe, expect, it } from "vitest";
import { SmartGate } from "./gate";

const FRAME_MS = 10;

/** Подаёт n одинаковых кадров, возвращает состояния порога по кадрам. */
function feed(gate: SmartGate, levelDb: number, vad: number, n: number): boolean[] {
  return Array.from({ length: n }, () => gate.update(levelDb, vad));
}

/** «Своя речь» с естественным разбросом громкости ±4 дБ. */
function speak(gate: SmartGate, levelDb: number, n: number): boolean[] {
  return Array.from({ length: n }, (_, i) => gate.update(levelDb + ((i * 7) % 9) - 4, 0.97));
}

describe("SmartGate — авто-режим", () => {
  it("открывается на своей речи, держит удержание 200 мс и закрывается", () => {
    const g = new SmartGate(FRAME_MS);
    expect(feed(g, -90, 0.01, 50).some(Boolean)).toBe(false);
    expect(feed(g, -20, 0.97, 30)[0]).toBe(true);
    const tail = feed(g, -90, 0.01, 40);
    expect(tail.slice(0, 19).every(Boolean)).toBe(true);
    expect(tail.slice(21).some(Boolean)).toBe(false);
  });

  it("громкая клавиатура без речи (VAD низкая) не открывает", () => {
    const g = new SmartGate(FRAME_MS);
    expect(feed(g, -18, 0.05, 200).some(Boolean)).toBe(false);
  });

  it("выучив голос, не пускает соседа на 20 дБ тише", () => {
    const g = new SmartGate(FRAME_MS);
    speak(g, -20, 400);
    feed(g, -90, 0.01, 50);
    expect(g.voiceDb).toBeGreaterThan(-20);
    expect(g.voiceDb).toBeLessThan(-14);
    expect(g.thresholdDb).toBeCloseTo(g.voiceDb - 11, 5);
    expect(feed(g, -40, 0.99, 300).some(Boolean)).toBe(false);
    // а свой голос по-прежнему открывает
    expect(speak(g, -20, 5)[0]).toBe(true);
  });

  it("пока голос не выучен, далёкая речь (ниже приора на 20+ дБ) не принимается за свой голос", () => {
    const g = new SmartGate(FRAME_MS);
    expect(feed(g, -50, 0.99, 500).some(Boolean)).toBe(false);
    expect(g.voiceDb).toBeNaN();
    expect(g.thresholdDb).toBeCloseTo(-26 - 11, 5);
  });

  it("тихий микрофон: голос ниже приора всё равно выучивается и проходит", () => {
    const g = new SmartGate(FRAME_MS);
    const opens = speak(g, -40, 600);
    expect(g.voiceDb).toBeLessThan(-33);
    expect(opens.slice(-100).filter(Boolean).length).toBeGreaterThan(95);
  });

  it("гистерезис: открытый порог держится, пока уровень не ниже порога − 4 дБ", () => {
    const g = new SmartGate(FRAME_MS);
    speak(g, -20, 300);
    const thr = g.thresholdDb;
    expect(feed(g, thr - 3, 0.9, 100).every(Boolean)).toBe(true);
    const below = feed(g, thr - 6, 0.9, 40);
    expect(below.slice(25).some(Boolean)).toBe(false);
  });

  it("чувствительность сдвигает порог: плюс — ниже", () => {
    const g = new SmartGate(FRAME_MS);
    speak(g, -20, 300);
    const base = g.thresholdDb;
    g.setSensitivity(5);
    expect(g.thresholdDb).toBeCloseTo(base - 5, 5);
    g.setSensitivity(-5);
    expect(g.thresholdDb).toBeCloseTo(base + 5, 5);
  });

  it("убавили микрофон на 25 дБ — после долгой «далёкой» речи переучивается, а не запирает", () => {
    const g = new SmartGate(FRAME_MS, { relearnFrames: 200 });
    speak(g, -20, 400);
    const quiet = speak(g, -45, 600);
    // первые 200 мс — удержание после громкой речи, дальше заперто, пока не переучится
    expect(quiet.slice(30, 150).some(Boolean)).toBe(false);
    expect(quiet.slice(-100).filter(Boolean).length).toBeGreaterThan(90);
    expect(g.voiceDb).toBeLessThan(-38);
  });

  it("resetLearning возвращает приор; seed задаёт голос и фон сразу", () => {
    const g = new SmartGate(FRAME_MS);
    speak(g, -15, 300);
    g.resetLearning();
    expect(g.voiceDb).toBeNaN();
    expect(g.thresholdDb).toBeCloseTo(-26 - 11, 5);
    g.seed(-30, -70);
    expect(g.voiceDb).toBe(-30);
    expect(g.noiseDb).toBe(-70);
    expect(g.thresholdDb).toBeCloseTo(-41, 5);
  });

  it("без VAD (шумодав не загрузился) работает по уровню", () => {
    const g = new SmartGate(FRAME_MS);
    feed(g, -70, NaN, 100);
    expect(feed(g, -20, NaN, 10)[0]).toBe(true);
  });
});

describe("SmartGate — ручной режим", () => {
  it("порог из настройки; VAD по желанию", () => {
    const g = new SmartGate(FRAME_MS);
    g.setDetector("manual");
    g.setManualThreshold(-45);
    g.setManualUseVad(false);
    expect(g.thresholdDb).toBe(-45);
    expect(feed(g, -40, 0.01, 3)[0]).toBe(true);
    const g2 = new SmartGate(FRAME_MS);
    g2.setDetector("manual");
    g2.setManualThreshold(-45);
    expect(feed(g2, -40, 0.01, 50).some(Boolean)).toBe(false);
    expect(feed(g2, -50, 0.99, 50).some(Boolean)).toBe(false);
    expect(feed(g2, -40, 0.99, 3)[0]).toBe(true);
  });

  it("порог ограничен −70…−10", () => {
    const g = new SmartGate(FRAME_MS);
    g.setDetector("manual");
    g.setManualThreshold(-99);
    expect(g.thresholdDb).toBe(-70);
    g.setManualThreshold(5);
    expect(g.thresholdDb).toBe(-10);
  });
});

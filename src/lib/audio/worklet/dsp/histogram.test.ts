import { describe, expect, it } from "vitest";
import { DecayingHistogram } from "./histogram";

describe("DecayingHistogram", () => {
  it("процентили равномерных данных", () => {
    const h = new DecayingHistogram(-100, 0, 0.5, 1e9);
    for (let db = -80; db < -20; db += 0.1) h.add(db);
    expect(h.percentile(0.1)).toBeCloseTo(-74, 0);
    expect(h.percentile(0.5)).toBeCloseTo(-50, 0);
    expect(h.percentile(0.9)).toBeCloseTo(-26, 0);
  });

  it("пустая — NaN; значения за краем прижимаются к краю", () => {
    const h = new DecayingHistogram(-100, 0, 1, 100);
    expect(h.percentile(0.5)).toBeNaN();
    h.add(20);
    expect(h.percentile(0.5)).toBeLessThanOrEqual(0);
    expect(h.percentile(0.5)).toBeGreaterThan(-1);
  });

  it("старое забывается: за полураспад вес старых данных падает вдвое", () => {
    const h = new DecayingHistogram(-100, 0, 0.5, 100);
    for (let i = 0; i < 1000; i++) h.add(-60);
    expect(h.percentile(0.9)).toBeCloseTo(-60, 0);
    for (let i = 0; i < 500; i++) h.add(-20);
    // 5 полураспадов: старое весит 1/32 — верхний процентиль уже у новых данных
    expect(h.percentile(0.9)).toBeCloseTo(-20, 0);
    expect(h.percentile(0.02)).toBeCloseTo(-60, 0);
  });

  it("перенормировка не ломает процентили на долгой работе", () => {
    const h = new DecayingHistogram(-100, 0, 0.5, 300);
    for (let i = 0; i < 200_000; i++) h.add(i % 2 ? -30 : -50);
    expect(h.weight).toBeGreaterThan(400);
    expect(h.percentile(0.75)).toBeCloseTo(-30, 0);
    expect(h.percentile(0.25)).toBeCloseTo(-50, 0);
  });
});

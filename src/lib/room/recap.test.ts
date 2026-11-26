import { describe, expect, it } from "vitest";
import { QUIET_PRESENT_MIN_MS, createRecapTracker, formatSpan, recapWorthShowing } from "./recap";

const MIN = 60_000;

describe("итоги вечера", () => {
  it("время, люди, пик, болтун и молчун", () => {
    const t = createRecapTracker("Вечерняя катка", 0);
    t.join("me", "Саня", 0);
    t.join("anya", "Аня", 0);
    t.join("gleb", "Глеб", 0);
    t.speakers(["anya"], 1 * MIN);
    t.speakers(["anya", "me"], 10 * MIN);
    t.speakers([], 20 * MIN);
    t.speakers(["gleb"], 30 * MIN);
    t.speakers([], 31 * MIN);
    t.join("vika", "Вика", 40 * MIN);
    t.leave("vika", 41 * MIN);
    const r = t.snapshot(60 * MIN);
    expect(r.durationMs).toBe(60 * MIN);
    expect(r.people).toBe(4);
    expect(r.peak).toBe(4);
    expect(r.top).toEqual({ identity: "anya", name: "Аня", talkMs: 19 * MIN });
    // Вика просидела минуту — не молчун; Глеб сказал минуту, меньше Сани.
    expect(r.quiet).toEqual({ identity: "gleb", name: "Глеб", talkMs: 1 * MIN });
  });

  it("говорит прямо сейчас — считается до момента снимка", () => {
    const t = createRecapTracker("x", 0);
    t.join("anya", "Аня", 0);
    t.speakers(["anya"], 0);
    expect(t.snapshot(2 * MIN).top?.talkMs).toBe(2 * MIN);
  });

  it("болтуна нет, если все молчали; молчуна нет, если вы один", () => {
    const t = createRecapTracker("x", 0);
    t.join("me", "Саня", 0);
    t.speakers(["me"], 0);
    t.speakers([], 10_000);
    const r = t.snapshot(QUIET_PRESENT_MIN_MS * 2);
    expect(r.top).toBeNull();
    expect(r.quiet).toBeNull();
  });

  it("вышли и вернулись: время стоит, говорение не тянется через паузу", () => {
    const t = createRecapTracker("x", 0);
    t.join("me", "Саня", 0);
    t.join("anya", "Аня", 0);
    t.speakers(["anya"], 0);
    t.pause(10 * MIN);
    t.resume(30 * MIN);
    t.join("me", "Саня", 30 * MIN);
    t.join("anya", "Аня", 30 * MIN);
    const r = t.snapshot(40 * MIN);
    expect(r.durationMs).toBe(20 * MIN);
    expect(r.top?.talkMs).toBe(10 * MIN);
  });

  it("реакции, звуки и кубик — счётчики", () => {
    const t = createRecapTracker("x", 0);
    t.reaction();
    t.reaction();
    t.sound();
    t.dice();
    expect(t.snapshot(0)).toMatchObject({ reactions: 2, sounds: 1, dice: 1 });
  });

  it("длительность словами и порог показа", () => {
    expect(formatSpan(30_000)).toBe("меньше минуты");
    expect(formatSpan(48 * MIN)).toBe("48 мин");
    expect(formatSpan(135 * MIN)).toBe("2 ч 15 мин");
    expect(formatSpan(120 * MIN)).toBe("2 ч");
    const t = createRecapTracker("x", 0);
    expect(recapWorthShowing(t.snapshot(MIN))).toBe(false);
    expect(recapWorthShowing(t.snapshot(3 * MIN))).toBe(true);
  });
});

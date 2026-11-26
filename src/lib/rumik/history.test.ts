import { describe, expect, it } from "vitest";
import { HISTORY_LIMIT, History } from "./history";

describe("история рисовалки", () => {
  it("назад и вперёд по шагам", () => {
    const h = new History<number>();
    expect(h.canUndo).toBe(false);
    expect(h.undo(0)).toBeNull();
    // Было 0 → стало 1 → стало 2.
    h.record(0);
    h.record(1);
    expect(h.undo(2)).toBe(1);
    expect(h.undo(1)).toBe(0);
    expect(h.canUndo).toBe(false);
    expect(h.redo(0)).toBe(1);
    expect(h.redo(1)).toBe(2);
    expect(h.canRedo).toBe(false);
    expect(h.redo(2)).toBeNull();
  });

  it("новое действие после отмены стирает «вперёд»", () => {
    const h = new History<string>();
    h.record("a");
    expect(h.undo("b")).toBe("a");
    expect(h.canRedo).toBe(true);
    h.record("a");
    expect(h.canRedo).toBe(false);
    expect(h.undo("c")).toBe("a");
  });

  it("не больше лимита: старые шаги забываются", () => {
    const h = new History<number>(3);
    for (let i = 0; i < 10; i++) h.record(i);
    expect(h.undo(10)).toBe(9);
    expect(h.undo(9)).toBe(8);
    expect(h.undo(8)).toBe(7);
    expect(h.undo(7)).toBeNull();
    expect(HISTORY_LIMIT).toBeGreaterThanOrEqual(10);
    expect(HISTORY_LIMIT).toBeLessThanOrEqual(30);
  });

  it("очистка забывает и назад, и вперёд", () => {
    const h = new History<number>();
    h.record(1);
    h.undo(2);
    h.record(3);
    h.clear();
    expect(h.canUndo || h.canRedo).toBe(false);
  });
});

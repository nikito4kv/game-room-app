import { describe, expect, it, vi } from "vitest";
import { DUCK_RELEASE_MS, createStreamDuck } from "./ducking";
import { createSpeakingStore } from "./speaking";

function manualTimers() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimeout: (fn: () => void, ms: number) => {
      timers.set(++seq, { at: now + ms, fn });
      return seq;
    },
    clearTimeout: (id: unknown) => void timers.delete(id as number),
    tick(ms: number) {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
    pending: () => timers.size,
  };
}

describe("приглушение звука показа", () => {
  it("заговорили — сразу; замолчали — через паузу; снова заговорили в паузе — не отпускаем", () => {
    const store = createSpeakingStore();
    const timers = manualTimers();
    const duck = createStreamDuck(store, timers);
    const seen = vi.fn();
    duck.subscribe(seen);
    expect(duck.get()).toBe(false);

    store.set("anna", true, 0.5);
    expect(duck.get()).toBe(true);
    store.set("anna", false, 0);
    timers.tick(DUCK_RELEASE_MS - 1);
    expect(duck.get()).toBe(true);
    store.set("boris", true, 0.4); // заговорил в паузе — возврат отменён
    timers.tick(DUCK_RELEASE_MS);
    expect(duck.get()).toBe(true);
    store.set("boris", false, 0);
    timers.tick(DUCK_RELEASE_MS);
    expect(duck.get()).toBe(false);
    expect(seen).toHaveBeenCalledTimes(2);
    expect(timers.pending()).toBe(0);
  });

  it("без подписчиков речь не слушаем и не держим таймеров", () => {
    const store = createSpeakingStore();
    const timers = manualTimers();
    const duck = createStreamDuck(store, timers);
    const off = duck.subscribe(() => {});
    store.set("anna", true, 0.5);
    store.set("anna", false, 0);
    off();
    expect(timers.pending()).toBe(0);
    expect(duck.get()).toBe(false);
    store.set("anna", true, 0.5);
    expect(duck.get()).toBe(false);
  });

  it("подписались, когда кто-то уже говорит, — сразу приглушено", () => {
    const store = createSpeakingStore();
    store.set("anna", true, 0.5);
    const duck = createStreamDuck(store, manualTimers());
    duck.subscribe(() => {});
    expect(duck.get()).toBe(true);
  });
});

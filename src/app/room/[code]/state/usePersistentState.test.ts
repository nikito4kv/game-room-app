import { describe, expect, it, vi } from "vitest";
import { persistentKey } from "./usePersistentState";

// Хранилище подменяем переменной: проверяем только логику ключа (память, запись,
// подписка), без React и localStorage.
function setup<T>(stored: T) {
  const storage = { value: stored };
  const read = vi.fn(() => storage.value);
  const write = vi.fn((v: T) => {
    storage.value = v;
  });
  return { storage, read, write };
}

describe("persistentKey", () => {
  it("читает хранилище лениво и один раз, пока есть подписчики", () => {
    const { read } = setup(5);
    const key = persistentKey({ read, initial: 1 });
    expect(read).not.toHaveBeenCalled();
    const off = key.subscribe(() => {});
    expect(key.get()).toBe(5);
    expect(key.get()).toBe(5);
    expect(read).toHaveBeenCalledTimes(1);
    off();
  });

  it("set пишет в память и в хранилище и будит подписчиков", () => {
    const { storage, read, write } = setup("toggle");
    const key = persistentKey({ read, write, initial: "toggle" });
    const onChange = vi.fn();
    key.subscribe(onChange);
    key.set("ptt");
    expect(key.get()).toBe("ptt");
    expect(storage.value).toBe("ptt");
    expect(write).toHaveBeenCalledWith("ptt");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("set принимает функцию от прошлого значения", () => {
    const { read } = setup<Record<string, number>>({ Анна: 2 });
    const key = persistentKey({ read, initial: {} });
    key.set((prev) => ({ ...prev, Борис: 0.5 }));
    expect(key.get()).toEqual({ Анна: 2, Борис: 0.5 });
  });

  it("без write хранилище не трогается (пишет вызывающий код)", () => {
    const { storage, read } = setup(1);
    const key = persistentKey({ read, initial: 1 });
    key.set(3);
    expect(storage.value).toBe(1);
    expect(key.get()).toBe(3);
  });

  it("после ухода последнего подписчика значение перечитывается из хранилища", () => {
    const { storage, read } = setup(true);
    const key = persistentKey({ read, initial: true });
    const off = key.subscribe(() => {});
    expect(key.get()).toBe(true);
    off();
    storage.value = false; // например, сменили в другой вкладке между входами в комнату
    expect(key.get()).toBe(false);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("отписанный слушатель больше не вызывается", () => {
    const { read } = setup(0);
    const key = persistentKey({ read, initial: 0 });
    const a = vi.fn();
    const b = vi.fn();
    const offA = key.subscribe(a);
    key.subscribe(b);
    offA();
    key.set(1);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });
});

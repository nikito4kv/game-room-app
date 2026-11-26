import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GALLERY_LIMIT,
  RUMIK_BUDGET,
  RUMIK_GALLERY_KEY,
  RUMIK_STORAGE_KEY,
  fitBudget,
  forgetSaved,
  getRumikStore,
  parseCurrent,
  parseGallery,
  resetRumikStoreForTests,
  saveMyPaint,
  subscribeRumik,
  unforgetSaved,
  updateMyPaint,
  withPaint,
  withPaintEdit,
  withSavedBack,
  withoutSaved,
  type RumikStore,
} from "./storage";

const png = (n: number) => `data:image/png;base64,AAA${n}`;
/** Рисунок длиной ~`size` символов: проверять бюджет и переполнение. */
const bigPng = (n: number, size: number) => `data:image/png;base64,${String(n).padEnd(size, "A")}`;
const EMPTY: RumikStore = { v: 1, paint: null, updatedAt: 0, gallery: [] };

describe("хранилище своего Румика: правила", () => {
  it("новый рисунок становится текущим, прежний уходит в галерею", () => {
    const a = withPaint(EMPTY, png(1), 10);
    expect(a.paint).toBe(png(1));
    expect(a.gallery).toEqual([]);
    const b = withPaint(a, png(2), 20);
    expect(b.paint).toBe(png(2));
    expect(b.gallery).toEqual([{ paint: png(1), at: 10 }]);
  });

  it("тот же рисунок ничего не меняет, повторов в галерее нет", () => {
    const a = withPaint(withPaint(EMPTY, png(1), 10), png(2), 20);
    expect(withPaint(a, png(2), 30)).toBe(a);
    // Вернулись к старому: он уходит из галереи в текущие, прежний — в галерею.
    const back = withPaint(a, png(1), 30);
    expect(back.paint).toBe(png(1));
    expect(back.gallery.map((g) => g.paint)).toEqual([png(2)]);
  });

  it("галерея не длиннее лимита, стереть — тоже сохраняет прежний", () => {
    let s = EMPTY;
    for (let i = 0; i < GALLERY_LIMIT + 5; i++) s = withPaint(s, png(i), i + 1);
    expect(s.gallery.length).toBe(GALLERY_LIMIT);
    const cleared = withPaint(s, null, 100);
    expect(cleared.paint).toBeNull();
    expect(cleared.gallery[0].paint).toBe(s.paint);
  });

  it("дорисовали тот же рисунок: текущий меняется, галерея не растёт", () => {
    const a = withPaint(withPaint(EMPTY, png(1), 10), png(2), 20);
    const b = withPaintEdit(a, png(3), 30);
    expect(b.paint).toBe(png(3));
    expect(b.gallery).toBe(a.gallery);
    expect(withPaintEdit(b, png(3), 40)).toBe(b);
    // «Стереть всё», потом отмена: рисунок вернулся в текущие и ушёл из галереи.
    const cleared = withPaint(b, null, 50);
    expect(cleared.gallery[0].paint).toBe(png(3));
    const undone = withPaintEdit(cleared, png(3), 60);
    expect(undone.paint).toBe(png(3));
    expect(undone.gallery.map((g) => g.paint)).toEqual([png(1)]);
  });

  it("убрать из галереи по времени и вернуть на прежнее место", () => {
    let s = EMPTY;
    for (let i = 1; i <= 4; i++) s = withPaint(s, png(i), i * 10);
    // Галерея: 3, 2, 1 — убираем середину.
    const removed = s.gallery[1];
    const without = withoutSaved(s, removed.at);
    expect(without.gallery.map((g) => g.paint)).toEqual([png(3), png(1)]);
    const back = withSavedBack(without, removed, 1);
    expect(back.gallery.map((g) => g.paint)).toEqual([png(3), png(2), png(1)]);
    // Уже на месте или снова текущий — ничего не меняется.
    expect(withSavedBack(back, removed, 1)).toBe(back);
    const current = withPaint(without, removed.paint, 99);
    expect(withSavedBack(current, removed, 0)).toBe(current);
  });

  it("испорченное хранилище не принимается, ранний формат читается", () => {
    expect(parseCurrent(JSON.stringify({ v: 1, paint: null, updatedAt: 0 }))).toEqual({ paint: null, updatedAt: 0 });
    expect(parseCurrent(JSON.stringify({ v: 1, paint: "javascript:alert(1)", updatedAt: 0 }))).toBeNull();
    expect(parseCurrent(JSON.stringify({ v: 2, paint: null, updatedAt: 0 }))).toBeNull();
    expect(parseCurrent("{не json")).toBeNull();
    expect(parseCurrent(null)).toBeNull();
    const legacy = { v: 1, paint: png(2), updatedAt: 5, gallery: [{ paint: png(1), at: 1 }] };
    expect(parseCurrent(JSON.stringify(legacy))?.legacyGallery).toEqual(legacy.gallery);
    expect(parseGallery(null)).toBeNull();
    expect(parseGallery(JSON.stringify([{ paint: "x", at: 1 }]))).toEqual([]);
    expect(parseGallery(JSON.stringify([{ paint: png(1), at: 1 }]))).toEqual([{ paint: png(1), at: 1 }]);
  });

  it("бюджет: текущий остаётся всегда, галерея урезается от старых", () => {
    const store: RumikStore = {
      v: 1,
      paint: bigPng(0, 400_000),
      updatedAt: 1,
      gallery: [1, 2, 3, 4, 5].map((i) => ({ paint: bigPng(i, 300_000), at: i })),
    };
    const fitted = fitBudget(store);
    expect(fitted.paint).toBe(store.paint);
    expect(fitted.gallery.map((g) => g.at)).toEqual([1, 2, 3]);
    const size = (fitted.paint?.length ?? 0) + fitted.gallery.reduce((n, g) => n + g.paint.length, 0);
    expect(size).toBeLessThanOrEqual(RUMIK_BUDGET);
    // Влезает — тот же объект.
    expect(fitBudget(fitted)).toBe(fitted);
    // Даже огромный текущий не выкидывается.
    const huge = bigPng(9, RUMIK_BUDGET + 10);
    expect(fitBudget({ ...store, paint: huge })).toMatchObject({ paint: huge, gallery: [] });
  });
});

// ── Браузер: подменный localStorage с квотой ─────────────────────────────────

type Quota = { chars: number; closed?: boolean };

/** localStorage с квотой в символах, как у браузера (ключ + значение). */
function fakeStorage(quota: Quota) {
  const data = new Map<string, string>();
  const used = () => [...data].reduce((n, [k, v]) => n + k.length + v.length, 0);
  const storage = {
    getItem: vi.fn((k: string) => {
      if (quota.closed) throw new DOMException("закрыто", "SecurityError");
      return data.get(k) ?? null;
    }),
    setItem: vi.fn((k: string, v: string) => {
      if (quota.closed) throw new DOMException("закрыто", "SecurityError");
      const before = data.get(k);
      const next = used() - (before === undefined ? 0 : k.length + before.length) + k.length + v.length;
      if (next > quota.chars) throw new DOMException("переполнено", "QuotaExceededError");
      data.set(k, v);
    }),
    removeItem: vi.fn((k: string) => {
      if (quota.closed) throw new DOMException("закрыто", "SecurityError");
      data.delete(k);
    }),
    get length() {
      return data.size;
    },
  };
  return { storage, data, used };
}

function fakeWindow() {
  const handlers = new Set<(e: StorageEvent) => void>();
  return {
    handlers,
    addEventListener: vi.fn((type: string, h: (e: StorageEvent) => void) => {
      if (type === "storage") handlers.add(h);
    }),
    removeEventListener: vi.fn((type: string, h: (e: StorageEvent) => void) => {
      if (type === "storage") handlers.delete(h);
    }),
  };
}

function setup(quota: Quota, prefill: Record<string, string> = {}) {
  const fake = fakeStorage(quota);
  for (const [k, v] of Object.entries(prefill)) fake.data.set(k, v);
  const win = fakeWindow();
  vi.stubGlobal("localStorage", fake.storage);
  vi.stubGlobal("window", win);
  resetRumikStoreForTests();
  return { ...fake, win };
}

/** Соседняя вкладка записала ключ: браузер шлёт сюда событие storage. */
function otherTab(win: ReturnType<typeof fakeWindow>, key: string | null, newValue: string | null) {
  const e = { key, newValue, storageArea: localStorage } as unknown as StorageEvent;
  win.handlers.forEach((h) => h(e));
}

describe("хранилище своего Румика: браузер", () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000 }));
  afterEach(() => {
    resetRumikStoreForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("рисунки не выедают место у ключа хоста и gr.device", () => {
    const others = { "gr.device": "x".repeat(2_000), "gr.host.ABC123": "k".repeat(64), "gr.requests": "[]" };
    const { data, used } = setup({ chars: 5_000_000 }, others);
    for (let i = 0; i < 12; i++) {
      vi.advanceTimersByTime(10);
      saveMyPaint(bigPng(i, 300_000));
    }
    const rumik = (data.get(RUMIK_STORAGE_KEY)?.length ?? 0) + (data.get(RUMIK_GALLERY_KEY)?.length ?? 0);
    expect(rumik).toBeLessThanOrEqual(RUMIK_BUDGET);
    for (const [k, v] of Object.entries(others)) expect(data.get(k)).toBe(v);
    // Остальным ключам места хватает.
    expect(5_000_000 - used()).toBeGreaterThan(3_000_000);
    const store = getRumikStore();
    expect(store.paint).toBe(bigPng(11, 300_000));
    expect(store.gallery.length).toBeLessThan(GALLERY_LIMIT);
    expect(parseGallery(data.get(RUMIK_GALLERY_KEY) ?? null)).toEqual(store.gallery);
  });

  it("квота кончилась раньше бюджета: старые рисунки выкидываются, текущий сохраняется", () => {
    const others = { "gr.device": "x".repeat(200_000) };
    const { data } = setup({ chars: 1_000_000 }, others);
    for (let i = 0; i < 8; i++) {
      vi.advanceTimersByTime(10);
      saveMyPaint(bigPng(i, 150_000));
    }
    expect(data.get("gr.device")).toBe(others["gr.device"]);
    expect(parseCurrent(data.get(RUMIK_STORAGE_KEY) ?? null)?.paint).toBe(bigPng(7, 150_000));
    const stored = parseGallery(data.get(RUMIK_GALLERY_KEY) ?? null) ?? [];
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.length).toBeLessThan(7);
    // Новые первыми: выкинуты самые старые.
    expect(stored[0].paint).toBe(bigPng(6, 150_000));
    // Снимок совпадает с тем, что легло в хранилище.
    expect(getRumikStore().gallery).toEqual(stored);
  });

  it("конец штриха пишет только текущий рисунок, галерею не трогает", () => {
    const { storage } = setup({ chars: 5_000_000 });
    for (let i = 1; i <= 3; i++) {
      vi.advanceTimersByTime(10);
      saveMyPaint(png(i));
    }
    storage.setItem.mockClear();
    updateMyPaint(png(4));
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.setItem.mock.calls[0][0]).toBe(RUMIK_STORAGE_KEY);
    // Убрать из галереи — наоборот, пишет только галерею.
    storage.setItem.mockClear();
    forgetSaved(getRumikStore().gallery[0].at);
    expect(storage.setItem.mock.calls.map((c) => c[0])).toEqual([RUMIK_GALLERY_KEY]);
  });

  it("убрали и вернули: рисунок снова в галерее и в хранилище", () => {
    const { data } = setup({ chars: 5_000_000 });
    saveMyPaint(png(1));
    vi.advanceTimersByTime(10);
    saveMyPaint(png(2));
    const [saved] = getRumikStore().gallery;
    forgetSaved(saved.at);
    expect(data.has(RUMIK_GALLERY_KEY)).toBe(false);
    unforgetSaved(saved, 0);
    expect(parseGallery(data.get(RUMIK_GALLERY_KEY) ?? null)).toEqual([saved]);
  });

  it("хранилище закрыто: живём в памяти, галерея не урезается", () => {
    setup({ chars: 5_000_000, closed: true });
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(10);
      saveMyPaint(png(i));
    }
    expect(getRumikStore().paint).toBe(png(3));
    expect(getRumikStore().gallery.map((g) => g.paint)).toEqual([png(2), png(1), png(0)]);
  });

  it("ранний формат: галерея из gr.rumik.v1 переезжает в свой ключ", () => {
    const legacy = { v: 1, paint: png(2), updatedAt: 5, gallery: [{ paint: png(1), at: 1 }] };
    const { data } = setup({ chars: 5_000_000 }, { [RUMIK_STORAGE_KEY]: JSON.stringify(legacy) });
    expect(getRumikStore().gallery).toEqual(legacy.gallery);
    updateMyPaint(png(3));
    expect(parseGallery(data.get(RUMIK_GALLERY_KEY) ?? null)).toEqual(legacy.gallery);
    expect(JSON.parse(data.get(RUMIK_STORAGE_KEY) ?? "{}")).toEqual({ v: 1, paint: png(3), updatedAt: 1_000 });
  });

  it("один слушатель storage на всех подписчиков", () => {
    const { win } = setup({ chars: 5_000_000 });
    const offs = [0, 1, 2, 3, 4].map(() => subscribeRumik(() => {}));
    expect(win.addEventListener).toHaveBeenCalledTimes(1);
    offs.slice(0, 4).forEach((off) => off());
    expect(win.removeEventListener).not.toHaveBeenCalled();
    offs[4]();
    offs[4]();
    expect(win.removeEventListener).toHaveBeenCalledTimes(1);
    expect(win.handlers.size).toBe(0);
  });

  it("соседняя вкладка: новое берётся из события, рисунок-строка не меняется от галереи", () => {
    const { win } = setup({ chars: 5_000_000 });
    saveMyPaint(png(1));
    const calls = vi.fn();
    const off = subscribeRumik(calls);
    const before = getRumikStore();
    otherTab(win, RUMIK_GALLERY_KEY, JSON.stringify([{ paint: png(7), at: 7 }]));
    expect(calls).toHaveBeenCalledTimes(1);
    expect(getRumikStore()).not.toBe(before);
    expect(getRumikStore().paint).toBe(before.paint);
    expect(getRumikStore().gallery).toEqual([{ paint: png(7), at: 7 }]);
    otherTab(win, RUMIK_STORAGE_KEY, JSON.stringify({ v: 1, paint: png(8), updatedAt: 8 }));
    expect(getRumikStore().paint).toBe(png(8));
    // Чужой ключ — не наше дело.
    otherTab(win, "gr.device", "{}");
    expect(calls).toHaveBeenCalledTimes(2);
    otherTab(win, null, null);
    expect(getRumikStore().paint).toBeNull();
    off();
  });
});

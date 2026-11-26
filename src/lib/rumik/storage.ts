// Свой Румик в этом браузере: текущий рисунок и «Мои Румики» — прошлые рисунки,
// чтобы вернуться к любому. Аккаунтов нет, поэтому дом рисунка — localStorage;
// настоящая копия — файл PNG («Сохранить»).
//
// Два ключа (версия в имени):
//   • gr.rumik.v1         — текущий рисунок { v, paint, updatedAt }. Его
//     перезаписывает конец каждого штриха, поэтому он один и небольшой;
//   • gr.rumik.v1.gallery — «Мои Румики» [{ paint, at }], новые первыми.
//     Пишется, только когда поменялась сама галерея.
// Ранний формат держал галерею внутри gr.rumik.v1: её читаем и переносим.
//
// Рисунок — PNG (data URL) слоя краски в рамке VIEW из ./geometry, в 2 раза
// крупнее (572×480): прозрачный вне фигуры, нарисован на стоящем Румике. Его
// принимает <Rumik paint={…} />. Для показа другим (R4) он уменьшается до 286×240.
//
// localStorage общий с ключом хоста, gr.device и «Моими заявками»: рисунки не
// должны его выесть. Поэтому у них свой бюджет (RUMIK_BUDGET): галерея
// урезается под него заранее, а не когда браузер уже отказал. Отказал всё
// равно (место заняли другие) — выкидываем старые рисунки и пробуем снова.
// Хранилище недоступно (приватный режим, запреты политики) — живём в памяти
// вкладки до перезагрузки.

export const RUMIK_STORAGE_KEY = "gr.rumik.v1";
export const RUMIK_GALLERY_KEY = "gr.rumik.v1.gallery";
/** Сколько прошлых рисунков помним в «Моих Румиках». */
export const GALLERY_LIMIT = 8;
/** Масштаб рисунка относительно рамки VIEW (286×240): холст 572×480. */
export const PAINT_SCALE = 2;
/**
 * Бюджет на все рисунки вместе (текущий и галерея), в символах. Квота
 * localStorage — от 5 млн символов (Chrome) до 5 МБ (Safari); полтора
 * миллиона оставляют остальным ключам больше половины даже в строгом случае.
 * Обычный рисунок — десятки тысяч символов, так что урезание бьёт только по
 * очень пёстрым загруженным картинкам. Текущий рисунок не урезается никогда:
 * холст 572×480 даже из шума меньше бюджета.
 */
export const RUMIK_BUDGET = 1_500_000;
/** Запас на JSON вокруг рисунка: кавычки, поля, запятые. */
const RECORD_OVERHEAD = 64;

export type SavedRumik = {
  /** PNG data URL слоя краски. */
  paint: string;
  /** Когда сохранён (Date.now()): он же id в галерее. */
  at: number;
};

/** Снимок для страницы: текущий рисунок и галерея вместе. */
export type RumikStore = {
  v: 1;
  /** Текущий рисунок; null — белый Румик. */
  paint: string | null;
  updatedAt: number;
  /** «Мои Румики», новые первыми, без текущего. */
  gallery: SavedRumik[];
};

const EMPTY: RumikStore = { v: 1, paint: null, updatedAt: 0, gallery: [] };

const isPng = (x: unknown): x is string => typeof x === "string" && x.startsWith("data:image/png;base64,");

function isSavedList(x: unknown): x is SavedRumik[] {
  return (
    Array.isArray(x) &&
    x.every((g) => typeof g === "object" && g !== null && isPng((g as SavedRumik).paint) && typeof (g as SavedRumik).at === "number")
  );
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Текущий рисунок из gr.rumik.v1 или null (ключа нет, испорчен руками).
 * `legacyGallery` — галерея раннего формата, если она лежала внутри.
 */
export function parseCurrent(
  raw: string | null,
): { paint: string | null; updatedAt: number; legacyGallery?: SavedRumik[] } | null {
  const x = parseJson(raw);
  if (typeof x !== "object" || x === null || Array.isArray(x)) return null;
  const s = x as Record<string, unknown>;
  if (s.v !== 1 || !(s.paint === null || isPng(s.paint)) || typeof s.updatedAt !== "number") return null;
  const legacy = isSavedList(s.gallery) && s.gallery.length > 0 ? s.gallery.slice(0, GALLERY_LIMIT) : undefined;
  return { paint: s.paint, updatedAt: s.updatedAt, ...(legacy && { legacyGallery: legacy }) };
}

/** Галерея из gr.rumik.v1.gallery: null — ключа нет; испорченная — пустая. */
export function parseGallery(raw: string | null): SavedRumik[] | null {
  if (raw === null) return null;
  const x = parseJson(raw);
  return isSavedList(x) ? x.slice(0, GALLERY_LIMIT) : [];
}

/**
 * Новый текущий рисунок. Прежний (если был и отличается) уходит в начало
 * галереи — так «старые скины» не теряются, — лишнее отрезается.
 */
export function withPaint(store: RumikStore, paint: string | null, now: number): RumikStore {
  if (paint === store.paint) return store;
  const gallery = store.paint ? [{ paint: store.paint, at: store.updatedAt || now }, ...store.gallery] : store.gallery;
  return {
    v: 1,
    paint,
    updatedAt: now,
    gallery: gallery.filter((g, i, all) => g.paint !== paint && all.findIndex((o) => o.paint === g.paint) === i).slice(0, GALLERY_LIMIT),
  };
}

/**
 * Тот же рисунок, ещё штрихи: текущий заменяется, галерея не растёт. Иначе
 * каждый штрих клал бы прежнее состояние в «Мои Румики». Копия нового рисунка
 * в галерее (вернули штрих отменой после «стереть всё») убирается.
 */
export function withPaintEdit(store: RumikStore, paint: string | null, now: number): RumikStore {
  if (paint === store.paint) return store;
  const gallery = store.gallery.some((g) => g.paint === paint) ? store.gallery.filter((g) => g.paint !== paint) : store.gallery;
  return { v: 1, paint, updatedAt: now, gallery };
}

/** Убрать рисунок из галереи по `at`. */
export function withoutSaved(store: RumikStore, at: number): RumikStore {
  return { ...store, gallery: store.gallery.filter((g) => g.at !== at) };
}

/**
 * Вернуть убранный рисунок на его место в галерее («Удалено · Вернуть»).
 * Он уже снова текущий или уже в галерее — ничего не меняется.
 */
export function withSavedBack(store: RumikStore, saved: SavedRumik, index: number): RumikStore {
  if (store.paint === saved.paint || store.gallery.some((g) => g.paint === saved.paint || g.at === saved.at)) return store;
  const gallery = [...store.gallery];
  gallery.splice(Math.min(Math.max(0, index), gallery.length), 0, saved);
  return { ...store, gallery: gallery.slice(0, GALLERY_LIMIT) };
}

/**
 * Галерея под бюджет: текущий рисунок остаётся всегда, из галереи — сколько
 * влезает, от новых к старым. Влезло всё — тот же объект.
 */
export function fitBudget(store: RumikStore, budget: number = RUMIK_BUDGET): RumikStore {
  let left = budget - (store.paint?.length ?? 0) - RECORD_OVERHEAD;
  let keep = 0;
  for (const g of store.gallery) {
    left -= g.paint.length + RECORD_OVERHEAD;
    if (left < 0) break;
    keep++;
  }
  return keep === store.gallery.length ? store : { ...store, gallery: store.gallery.slice(0, keep) };
}

function sameGallery(a: readonly SavedRumik[], b: readonly SavedRumik[]): boolean {
  return a === b || (a.length === b.length && a.every((g, i) => g.at === b[i].at && g.paint === b[i].paint));
}

// ── Браузер ──────────────────────────────────────────────────────────────────

/** Снимок для страницы (тот же объект, пока ничего не менялось); null — ещё не читали. */
let snapshot: RumikStore | null = null;
/** Что, по нашим сведениям, лежит под ключом галереи: с ним сравниваем, писать ли её. */
let storedGallery: readonly SavedRumik[] = [];
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

function getItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function isQuotaError(e: unknown): boolean {
  if (typeof DOMException === "undefined" || !(e instanceof DOMException)) return false;
  // Имя и код у браузеров разные: Chrome и Safari — 22, старый Firefox — 1014.
  return e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22 || e.code === 1014;
}

/** Записать (null — удалить): ok; full — не влезло; closed — хранилище недоступно. */
function put(key: string, value: string | null): "ok" | "full" | "closed" {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return "ok";
  } catch (e) {
    return isQuotaError(e) ? "full" : "closed";
  }
}

/** Пишет галерею; не влезла — выкидывает самые старые и пробует снова. */
function writeGallery(list: SavedRumik[]): { list: SavedRumik[]; closed: boolean } {
  for (;;) {
    const r = put(RUMIK_GALLERY_KEY, list.length > 0 ? JSON.stringify(list) : null);
    if (r === "ok") {
      storedGallery = list;
      return { list, closed: false };
    }
    if (r === "closed" || list.length === 0) return { list, closed: r === "closed" };
    list = list.slice(0, -1);
  }
}

/**
 * Записать то, что поменялось. Конец штриха трогает только gr.rumik.v1:
 * мегабайты галереи на каждый штрих не переписываются. Вернёт то, что
 * осталось после урезания, или `next`, если хранилище закрыто (тогда всё в памяти).
 */
function persist(prev: RumikStore, next: RumikStore): RumikStore {
  let gallery = next.gallery;
  // Галерея — первой: если она сжалась, место освободится до записи текущего.
  if (!sameGallery(storedGallery, gallery)) {
    const r = writeGallery(gallery);
    if (r.closed) return next;
    gallery = r.list;
  }
  if (prev.paint !== next.paint || prev.updatedAt !== next.updatedAt) {
    const current = JSON.stringify({ v: 1, paint: next.paint, updatedAt: next.updatedAt });
    for (;;) {
      const r = put(RUMIK_STORAGE_KEY, current);
      if (r === "closed") return next;
      // Не влез даже текущий — освобождаем место галереей, от старых к новым.
      // Освобождать нечего — текущий живёт в памяти вкладки.
      if (r === "ok" || gallery.length === 0) break;
      gallery = writeGallery(gallery.slice(0, -1)).list;
    }
  }
  return gallery === next.gallery ? next : { ...next, gallery };
}

function readAll(): RumikStore {
  const current = parseCurrent(getItem(RUMIK_STORAGE_KEY));
  const gallery = parseGallery(getItem(RUMIK_GALLERY_KEY));
  storedGallery = gallery ?? [];
  if (!current && !gallery) return EMPTY;
  return {
    v: 1,
    paint: current?.paint ?? null,
    updatedAt: current?.updatedAt ?? 0,
    // Ранний формат: галерея внутри текущего. Переедет в свой ключ при первой записи.
    gallery: gallery ?? current?.legacyGallery ?? [],
  };
}

function commit(next: RumikStore): void {
  const prev = getRumikStore();
  if (next === prev) return;
  snapshot = persist(prev, fitBudget(next));
  emit();
}

/** Всё сохранённое о своём Румике (снимок; тот же объект, пока ничего не менялось). */
export function getRumikStore(): RumikStore {
  if (typeof window === "undefined") return EMPTY;
  snapshot ??= readAll();
  return snapshot;
}

/** Текущий рисунок (PNG data URL) или null — белый Румик. */
export function loadMyPaint(): string | null {
  return getRumikStore().paint;
}

/** Запомнить текущий рисунок (null — стереть). Прежний уходит в «Мои Румики». */
export function saveMyPaint(paint: string | null): void {
  commit(withPaint(getRumikStore(), paint, Date.now()));
}

/**
 * Дорисовали текущий рисунок (конец штриха, заливка, отмена): заменить его, не
 * трогая «Мои Румики». Новый рисунок (стёрли всё, загрузили файл, вернули из
 * галереи) — saveMyPaint.
 */
export function updateMyPaint(paint: string | null): void {
  commit(withPaintEdit(getRumikStore(), paint, Date.now()));
}

/** Убрать рисунок из «Моих Румиков». */
export function forgetSaved(at: number): void {
  commit(withoutSaved(getRumikStore(), at));
}

/** Вернуть только что убранный рисунок на прежнее место в «Моих Румиках». */
export function unforgetSaved(saved: SavedRumik, index: number): void {
  commit(withSavedBack(getRumikStore(), saved, index));
}

/** Соседняя вкладка поменяла рисунок или галерею: новое значение берём из события. */
function onStorage(e: StorageEvent): void {
  try {
    if (e.storageArea && e.storageArea !== localStorage) return;
  } catch {
    return;
  }
  if (e.key !== null && e.key !== RUMIK_STORAGE_KEY && e.key !== RUMIK_GALLERY_KEY) return;
  if (snapshot === null) {
    emit();
    return;
  }
  if (e.key === RUMIK_STORAGE_KEY) {
    const current = parseCurrent(e.newValue);
    snapshot = { ...snapshot, paint: current?.paint ?? null, updatedAt: current?.updatedAt ?? 0 };
  } else if (e.key === RUMIK_GALLERY_KEY) {
    const gallery = parseGallery(e.newValue) ?? [];
    storedGallery = gallery;
    snapshot = { ...snapshot, gallery };
  } else {
    // Хранилище очистили целиком.
    storedGallery = [];
    snapshot = EMPTY;
  }
  emit();
}

/**
 * Подписка на изменения: в этой вкладке (saveMyPaint) и в соседних (событие
 * storage) — нарисовали на главной, лобби в другой вкладке тоже видит.
 * Слушатель storage один на всех подписчиков: Румик есть у каждого места за столом.
 */
export function subscribeRumik(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("storage", onStorage);
  return () => {
    if (!listeners.delete(listener)) return;
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

/** Только для тестов: забыть снимок и подписчиков. */
export function resetRumikStoreForTests(): void {
  if (listeners.size > 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  listeners.clear();
  snapshot = null;
  storedGallery = [];
}

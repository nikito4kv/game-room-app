// Чужие показы экрана на сцене: порядок и какой из них крупно. Чистые функции.
//
// LiveKit отдаёт показы в порядке участников (кто раньше вошёл в комнату), а
// не по времени начала показа — поэтому крупно оказывался не тот, кто только
// что начал (аудит C-11). Порядок появления ведём сами: каждому новому sid —
// следующий номер.

/** sid показа → номер появления (чем больше, тем позже начался). */
export type AppearanceOrder = ReadonlyMap<string, number>;

/**
 * Обновить порядок появления: новые sid получают следующие номера (в порядке
 * списка), пропавшие забываются. Если ничего не поменялось — тот же объект,
 * чтобы не будить React зря.
 */
export function trackAppearance(
  prev: AppearanceOrder,
  sids: readonly string[],
  nextSeq: number,
): { order: AppearanceOrder; nextSeq: number } {
  const same = sids.length === prev.size && sids.every((sid) => prev.has(sid));
  if (same) return { order: prev, nextSeq };
  const order = new Map<string, number>();
  let seq = nextSeq;
  for (const sid of sids) order.set(sid, prev.get(sid) ?? seq++);
  return { order, nextSeq: seq };
}

/** Отсортировать по времени появления: первым — самый ранний показ. */
export function byAppearance<T>(items: readonly T[], sidOf: (item: T) => string, order: AppearanceOrder): T[] {
  return [...items].sort((a, b) => (order.get(sidOf(a)) ?? 0) - (order.get(sidOf(b)) ?? 0));
}

/**
 * Какой показ крупно. Выбранный вручную — пока он идёт и не скрыт; иначе самый
 * новый из видимых. `visible` — в порядке появления.
 */
export function pickFocus(visible: readonly string[], manual: string | null): string | null {
  if (manual && visible.includes(manual)) return manual;
  return visible.length > 0 ? visible[visible.length - 1] : null;
}

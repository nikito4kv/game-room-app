// Очередь тостов — чистые функции над массивом, без React. Тосты с тем же id
// обновляются на месте (так «Переподключаемся…» превращается в «Снова на
// связи», а повторные события не плодят дубликаты).

export type ToastTone = "neutral" | "signal" | "alert" | "caution";

/** Сколько тостов видно одновременно; остальные ждут в очереди. */
export const MAX_VISIBLE_TOASTS = 3;
/** Сколько всего держим (видимые + очередь). Старые выкидываем. */
export const MAX_QUEUED_TOASTS = 8;

export const TOAST_DURATION: Record<ToastTone, number> = {
  neutral: 4000,
  signal: 4000,
  caution: 6000,
  alert: 7000,
};

export type QueuedToast = { id: string; leaving?: boolean };

/** Добавить или обновить тост. Обновление сохраняет место в очереди. */
export function upsertToast<T extends QueuedToast>(list: readonly T[], item: T, max = MAX_QUEUED_TOASTS): T[] {
  const at = list.findIndex((t) => t.id === item.id);
  if (at >= 0) {
    const next = list.slice();
    next[at] = item;
    return next;
  }
  const next = [...list, item];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** Пометить тост уходящим (для анимации выхода). */
export function markLeaving<T extends QueuedToast>(list: readonly T[], id: string): T[] {
  return list.map((t) => (t.id === id ? { ...t, leaving: true } : t));
}

export function removeToast<T extends QueuedToast>(list: readonly T[], id: string): T[] {
  return list.filter((t) => t.id !== id);
}

/** Что показывать сейчас: первые N неуходящих + уходящие (доигрывают выход). */
export function visibleToasts<T extends QueuedToast>(list: readonly T[], max = MAX_VISIBLE_TOASTS): T[] {
  const out: T[] = [];
  let shown = 0;
  for (const t of list) {
    if (t.leaving) out.push(t);
    else if (shown < max) {
      out.push(t);
      shown++;
    }
  }
  return out;
}

/**
 * Показать тост id сразу, без очереди: ответ на нажатие не должен ждать, пока
 * дотикают старые. Тост встаёт сразу за видимыми (перед ждущими), а если
 * видимые места заняты — evict: самый старый видимый, его надо закрыть.
 * Уже видимый тост остаётся на месте.
 */
export function promoteToast<T extends QueuedToast>(
  list: readonly T[],
  id: string,
  max = MAX_VISIBLE_TOASTS,
): { list: T[]; evict: string | null } {
  const item = list.find((t) => t.id === id);
  if (!item || item.leaving || visibleToasts(list, max).includes(item)) return { list: [...list], evict: null };
  const rest = list.filter((t) => t !== item);
  const visible = rest.filter((t) => !t.leaving).slice(0, max);
  const evict = visible.length >= max ? visible[0].id : null;
  const at = visible.length > 0 ? rest.indexOf(visible[visible.length - 1]) + 1 : 0;
  return { list: [...rest.slice(0, at), item, ...rest.slice(at)], evict };
}

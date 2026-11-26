// Чьи клавиши: рисовалки (B, E, G, I, M, Ctrl+Z…) или того, что поверх неё.
// Чистое решение без React — его проверяет editorKeys.test.ts.

/** Хватает closest и contains: настоящий Element подходит. */
export type KeyNode<N> = {
  closest(selector: string): N | null;
  contains(other: N | null): boolean;
};

/** Поля ввода: там буквы и Ctrl+Z — свои. */
export const FIELD_SELECTOR = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

/**
 * Можно ли рисовалке взять клавишу.
 *   • Фокус в поле ввода (HEX-цвет, ник в лобби) — нет.
 *   • Фокус в окне, где рисовалки нет (открытка поверх неё), — нет.
 *   • Открыто окно, а рисовалка не в верхнем — нет. Верхнее — последнее
 *     открытое в документе: вложенное окно (открытка внутри окна лобби) идёт
 *     после своего.
 * `openDialogs` — `document.querySelectorAll("dialog[open]")` по порядку.
 */
export function editorOwnsKey<N extends KeyNode<N>>(target: N | null, root: N, openDialogs: readonly N[]): boolean {
  if (target?.closest(FIELD_SELECTOR)) return false;
  const host = target?.closest("dialog") ?? null;
  if (host && !host.contains(root)) return false;
  const top = openDialogs.at(-1);
  return !top || top.contains(root);
}

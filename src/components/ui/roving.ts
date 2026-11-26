// Стрелочная навигация внутри группы (radiogroup, tablist, menu): по какому
// индексу перейти от текущего. Чистая функция — проверяется тестом.

export type RovingKey = "next" | "prev" | "first" | "last";

/** Клавиша → направление. vertical/horizontal — какие стрелки слушать. */
export function rovingKey(key: string, orientation: "horizontal" | "vertical" | "both"): RovingKey | null {
  const h = orientation !== "vertical";
  const v = orientation !== "horizontal";
  if ((h && key === "ArrowRight") || (v && key === "ArrowDown")) return "next";
  if ((h && key === "ArrowLeft") || (v && key === "ArrowUp")) return "prev";
  if (key === "Home") return "first";
  if (key === "End") return "last";
  return null;
}

/**
 * Следующий доступный индекс по кругу. `disabled[i] === true` пропускаем.
 * Если доступных нет — возвращает текущий.
 */
export function nextIndex(current: number, move: RovingKey, disabled: readonly boolean[]): number {
  const n = disabled.length;
  if (n === 0) return current;
  const ok = (i: number) => !disabled[i];
  if (move === "first" || move === "last") {
    const order = move === "first" ? [...Array(n).keys()] : [...Array(n).keys()].reverse();
    return order.find(ok) ?? current;
  }
  const step = move === "next" ? 1 : -1;
  for (let k = 1; k <= n; k++) {
    const i = (((current + step * k) % n) + n) % n;
    if (ok(i)) return i;
  }
  return current;
}

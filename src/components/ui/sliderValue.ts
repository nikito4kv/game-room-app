// Чистая логика ползунка (Slider.tsx): примагничивание к рискам.

export type SliderInput = "pointer" | "keyboard";

/**
 * Значение после сдвига ползунка. К риске (100% у громкости, 0 у подстройки)
 * примагничиваем, только когда тянут мышью или пальцем. Со стрелок шаг меньше
 * «магнита» (шаг 1 при snap 4), и ползунок навсегда застревал бы на риске:
 * каждое нажатие возвращало бы его обратно. С клавиатуры значение идёт точно по шагу.
 */
export function sliderValue(
  raw: number,
  { marks, snap, input }: { marks?: number[]; snap?: number; input: SliderInput },
): number {
  if (input === "keyboard" || !marks || !snap) return raw;
  for (const m of marks) if (Math.abs(raw - m) <= snap) return m;
  return raw;
}

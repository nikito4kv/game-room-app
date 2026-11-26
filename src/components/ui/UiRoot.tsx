import type { HTMLAttributes, Ref } from "react";
import { cn } from "./cn";

/**
 * Корень любого экрана. Ставит data-ui (база шрифта, цвета, фокуса, полос
 * прокрутки и color-scheme — globals.css) и при желании тему. Без него у
 * экрана не будет этой базы: кегля, цвета текста и кольца фокуса.
 */
export function UiRoot({
  ref,
  theme,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  ref?: Ref<HTMLDivElement>;
  /** Тема для поддерева. По умолчанию — тёмная (или та, что на <html>). */
  theme?: "dark" | "light";
}) {
  return (
    <div
      ref={ref}
      data-ui=""
      data-theme={theme === "light" ? "light" : undefined}
      className={cn("bg-canvas text-ink", className)}
      {...props}
    />
  );
}

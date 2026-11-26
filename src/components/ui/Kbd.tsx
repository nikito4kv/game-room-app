import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * Клавиша-подсказка (keycap): «M», «Space», «Enter». Похожа на настоящую
 * клавишу — нижняя грань чуть толще. Текст клавиши берите из
 * formatKeyCode (src/lib/keys.ts), а не хардкодом: бинды переназначаются.
 */
export function Kbd({
  children,
  size = "md",
  className,
}: {
  children: ReactNode;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-key border border-line-strong bg-wash-2 font-body font-semibold text-ink-2",
        "shadow-[inset_0_-1px_0_0_var(--gr-line-strong)]",
        size === "sm" ? "h-[18px] min-w-[18px] px-1 text-micro" : "h-[22px] min-w-[22px] px-1.5 text-caption",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

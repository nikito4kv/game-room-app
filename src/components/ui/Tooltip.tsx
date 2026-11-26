"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "./cn";
import type { Align, Side } from "./floating";
import { FLOATING_RESET, usePlaceFloating, useTopLayer } from "./useFloating";

// «Разогрев»: если только что была видна другая подсказка, следующая
// появляется сразу и без анимации — пробежка мышью по доку не тормозит.
let lastHiddenAt = 0;
const WARM_MS = 400;

/**
 * Подсказка при наведении мышью (после паузы) и сразу при фокусе с
 * клавиатуры. На тач-экранах не появляется. Дублирует видимую подпись или
 * aria-label, поэтому для скринридера скрыта.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  align = "center",
  delay = 450,
  disabled = false,
  className,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: Side;
  align?: Align;
  /** Пауза перед первым показом, мс. */
  delay?: number;
  disabled?: boolean;
  /** Класс обёртки-триггера (например, flex-1, если кнопка тянется). */
  className?: string;
}) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [instant, setInstant] = useState(false);
  const visible = open && !disabled;

  useTopLayer(visible, tipRef);
  usePlaceFloating(visible, tipRef, wrapRef, { side, align, offset: 8 });

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Esc прячет подсказку (как в Discord/Chrome), не трогая остальное.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      lastHiddenAt = performance.now();
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible]);

  function show(immediate: boolean) {
    if (disabled) return;
    window.clearTimeout(timer.current);
    const warm = performance.now() - lastHiddenAt < WARM_MS;
    if (immediate || warm) {
      setInstant(warm);
      setOpen(true);
    } else {
      timer.current = window.setTimeout(() => {
        setInstant(false);
        setOpen(true);
      }, delay);
    }
  }

  function hide() {
    window.clearTimeout(timer.current);
    if (open) lastHiddenAt = performance.now();
    setOpen(false);
  }

  return (
    <span
      ref={wrapRef}
      className={cn("inline-flex", className)}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") show(false);
      }}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(e) => {
        if (e.target instanceof Element && e.target.matches(":focus-visible")) show(true);
      }}
      onBlur={hide}
    >
      {children}
      <span
        ref={tipRef}
        popover="manual"
        aria-hidden="true"
        data-instant={instant || undefined}
        className={cn(
          FLOATING_RESET,
          "pointer-events-none max-w-64 rounded-item bg-overlay px-2.5 py-1.5 text-label text-ink shadow-float",
          "opacity-100 transition-[opacity,scale] duration-140 ease-swift",
          "starting:open:opacity-0 motion-safe:starting:open:scale-[0.97]",
          "data-instant:transition-none",
        )}
      >
        {content}
      </span>
    </span>
  );
}

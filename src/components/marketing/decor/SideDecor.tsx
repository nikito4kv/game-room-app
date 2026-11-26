import type { CSSProperties, ReactNode } from "react";
import { avatarColorVar } from "@/components/ui/avatarColor";
import { cn } from "@/components/ui/cn";

// Украшения витрины по краям колонки 1200 (бренд-слой, DESIGN_SYSTEM.md §8):
// Румики и скруглённые квадраты в боковых полосах главной, /pricing, /clubs,
// /rooms. Только на широком экране (от 1400 px), целиком, без обрезки. Ничего не
// сдвигают в раскладке (absolute), не ловят мышь, скринридер их не видит.
// Родитель — секция во всю ширину с `relative` (у Section из marketing это уже так).
//
// Порог 1400, а не 1380 из макета: в Chrome на Windows полоса прокрутки отнимает
// 17 px, и на 1380–1395 Румик шириной 100 px заезжал на колонку.

/**
 * Скрыть, если украшения выключены флагом rumik_decor в админке: DecorSwitch
 * ставит на <html> атрибут data-decor="off".
 */
export const DECOR_OFF = "[:root[data-decor=off]_&]:hidden";

const BASE = cn("pointer-events-none absolute z-0 hidden min-[1400px]:block", DECOR_OFF);

/** Ширина Румика в полосе: четверть свободного места у колонки, но 100–210 px. */
const WIDTH = "clamp(100px, calc((100vw - 1200px) / 4), 210px)";

/** Отступ от края секции до места у колонки шириной `column` (px), за вычетом `extra`. */
const besideColumn = (column: number, extra: string) => `max(8px, calc(50% - ${column / 2}px - ${extra}))`;

/**
 * Румик в боковой полосе. `top` — отступ от верха секции в px; `sit` — сидит на
 * линии-разделителе сверху секции, свесив ноги (тогда `top` не нужен).
 * `column` — ширина колонки, у которой он стоит (по умолчанию 1200; /rooms — 880).
 */
export function SideDecor({
  side,
  top,
  sit = false,
  column = 1200,
  children,
  className,
}: {
  side: "left" | "right";
  top?: number;
  sit?: boolean;
  column?: number;
  /** Обычно `<Rumik sticker … />`; на правой стороне — с `flip`, чтобы смотрел на страницу. */
  children: ReactNode;
  className?: string;
}) {
  const style = {
    "--w": WIDTH,
    width: "var(--w)",
    top: sit ? "calc(var(--w) * -0.6)" : (top ?? 0),
    [side]: besideColumn(column, "var(--w) - 6px"),
  } as CSSProperties;
  return (
    <div aria-hidden="true" className={cn(BASE, className)} style={style}>
      {children}
    </div>
  );
}

/**
 * Тихий скруглённый квадрат в полосе — «конфетти» бренд-слоя. `inset` — отступ
 * от колонки 1200 наружу (px), `color` — индекс палитры аватаров 0–9; контурный
 * полупрозрачный, залитый — почти плотный.
 */
export function DecorSquare({
  side,
  top,
  inset = 40,
  size = 30,
  color = 5,
  rotate = 0,
  filled = false,
  column = 1200,
}: {
  side: "left" | "right";
  top: number;
  column?: number;
  inset?: number;
  size?: number;
  color?: number;
  rotate?: number;
  filled?: boolean;
}) {
  const paint = avatarColorVar(color);
  const style = {
    top,
    width: size,
    [side]: besideColumn(column, `${inset + size}px`),
  } as CSSProperties;
  return (
    <div aria-hidden="true" className={BASE} style={style}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        focusable="false"
        className="block"
        style={{ rotate: `${rotate}deg`, opacity: filled ? 0.9 : 0.5 }}
      >
        <rect
          x={2}
          y={2}
          width={size - 4}
          height={size - 4}
          rx={Math.round(size * 0.32 * 10) / 10}
          strokeWidth={3}
          style={{ stroke: paint, fill: filled ? paint : "none" }}
        />
      </svg>
    </div>
  );
}

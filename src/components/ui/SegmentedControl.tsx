"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "./cn";
import { Icon, type IconName } from "./icons";
import { nextIndex, rovingKey } from "./roving";

export type SegmentOption<T extends string> = {
  value: T;
  label: ReactNode;
  icon?: IconName;
  disabled?: boolean;
};

/**
 * Сегменты: выбор одного из 2–4 коротких вариантов («Авто / Вручную / Выкл»).
 * Сегменты равной ширины, выбранный подсвечен «плашкой», которая переезжает
 * сдвигом (transform) — только при смене, в покое ничего не движется.
 * Клавиатура: стрелки меняют выбор, Tab — уходит из группы.
 */
export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  label,
  size = "md",
  block = false,
  className,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: SegmentOption<T>[];
  /** Подпись группы для скринридера. */
  label: string;
  size?: "sm" | "md";
  block?: boolean;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const n = options.length;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const move = rovingKey(e.key, "horizontal");
    if (!move) return;
    e.preventDefault();
    const next = nextIndex(
      index,
      move,
      options.map((o) => !!o.disabled),
    );
    onValueChange(options[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        "relative grid rounded-control border border-line bg-wash-1 p-[3px]",
        block ? "w-full" : "w-fit",
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[3px] left-[3px] top-[3px] rounded-[9px] bg-overlay shadow-[0_0_0_1px_var(--gr-line-strong),0_1px_2px_rgb(0_0_0/0.35)] transition-transform duration-180 ease-swift"
        style={{
          width: `calc((100% - 6px) / ${n})`,
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {options.map((o, i) => {
        const selected = i === index;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onValueChange(o.value)}
            className={cn(
              "relative z-[1] inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] font-medium",
              "transition-colors duration-140 focus-visible:outline-offset-[-2px] disabled:opacity-40",
              size === "sm" ? "h-7 px-2.5 text-label" : "h-8 px-3 text-body",
              selected ? "text-ink" : "text-ink-3 hover:text-ink-2",
            )}
          >
            {o.icon && <Icon name={o.icon} size={16} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

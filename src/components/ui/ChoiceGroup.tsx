"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "./cn";
import { Icon, type IconName } from "./icons";
import { nextIndex, rovingKey } from "./roving";

export type Choice<T extends string> = {
  value: T;
  title: ReactNode;
  description?: ReactNode;
  /** Короткая техническая строка справа от заголовка: «1080p · 60 к/с». */
  meta?: ReactNode;
  icon?: IconName;
  disabled?: boolean;
};

/**
 * Выбор одного варианта карточками — когда у вариантов есть описание
 * (профили качества показа экрана). Для коротких подписей — SegmentedControl.
 */
export function ChoiceGroup<T extends string>({
  value,
  onValueChange,
  options,
  label,
  columns = 1,
  className,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: Choice<T>[];
  label: string;
  columns?: 1 | 2;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const move = rovingKey(e.key, "both");
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
      className={cn("grid gap-2", columns === 2 && "sm:grid-cols-2", className)}
    >
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
              "group relative flex w-full items-start gap-3 rounded-card border p-3.5 text-left",
              "transition-[background-color,border-color] duration-140 ease-swift disabled:opacity-45",
              selected
                ? "border-ink/70 bg-wash-2"
                : "border-line bg-transparent hover:border-line-strong hover:bg-wash-1",
            )}
          >
            {o.icon && (
              <span
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-item",
                  selected ? "bg-ink text-inverse" : "bg-wash-2 text-ink-2",
                )}
              >
                <Icon name={o.icon} size={18} />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="text-body font-semibold text-ink">{o.title}</span>
                {/* На подложке выбранного ink-3 даёт 4,35:1 — ниже AA, поэтому там ink-2. */}
                {o.meta && (
                  <span className={cn("text-label tabular-nums", selected ? "text-ink-2" : "text-ink-3")}>{o.meta}</span>
                )}
              </span>
              {o.description && (
                <span className="mt-1 block text-label text-ink-2">{o.description}</span>
              )}
            </span>
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full border",
                selected ? "border-ink bg-ink text-inverse" : "border-line-control",
              )}
            >
              {selected && <Icon name="check" size={12} strokeWidth={3} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

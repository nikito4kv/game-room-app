"use client";

import { useId, useRef, type InputHTMLAttributes, type ReactNode, type Ref } from "react";
import { cn } from "./cn";
import { Icon, type IconName } from "./icons";
import { sliderValue } from "./sliderValue";

export type SliderProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "defaultValue" | "onChange" | "type" | "size" | "min" | "max" | "step"
> & {
  ref?: Ref<HTMLInputElement>;
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Видимая подпись над полосой. Без неё нужен aria-label. */
  label?: ReactNode;
  /** Показать значение справа от подписи. */
  showValue?: boolean;
  /** Как показать значение («120%»). Им же озвучивается aria-valuetext. */
  formatValue?: (value: number) => string;
  /** Риски на шкале — например, 100% у громкости (значение по умолчанию). */
  marks?: number[];
  /** Примагнитить к риске, если ближе, чем на snap единиц (только мышью и пальцем). */
  snap?: number;
  iconStart?: IconName;
  iconEnd?: IconName;
  /**
   * scrim — поверх видео (громкость трансляции): белая полоса и ручка в любой
   * теме, как у IconButton variant="scrim" — картинка бывает любой яркости.
   */
  variant?: SliderVariant;
  wrapperClassName?: string;
};

export type SliderVariant = "default" | "scrim";

/** Дорожка, заливка, риски и ручка — по варианту. Классы целиком: их ищет Tailwind. */
const VARIANT: Record<SliderVariant, { track: string; fill: string; mark: string; thumb: string }> = {
  default: {
    track: "bg-wash-3",
    fill: "bg-ink",
    mark: "bg-line-control",
    thumb: "[&::-webkit-slider-thumb]:bg-ink [&::-moz-range-thumb]:bg-ink",
  },
  scrim: {
    track: "bg-[rgb(255_255_255/0.25)]",
    fill: "bg-white",
    mark: "bg-[rgb(255_255_255/0.5)]",
    thumb: "[&::-webkit-slider-thumb]:bg-white [&::-moz-range-thumb]:bg-white",
  },
};

const THUMB =
  "[&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full " +
  "[&::-webkit-slider-thumb]:shadow-[0_1px_3px_rgb(0_0_0/0.5)] " +
  "[&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:duration-140 " +
  "active:[&::-webkit-slider-thumb]:scale-110 " +
  "focus-visible:[&::-webkit-slider-thumb]:shadow-[0_0_0_2px_var(--gr-canvas),0_0_0_4px_var(--gr-focus)] " +
  "[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 " +
  "[&::-moz-range-thumb]:shadow-[0_1px_3px_rgb(0_0_0/0.5)] " +
  "focus-visible:[&::-moz-range-thumb]:shadow-[0_0_0_2px_var(--gr-canvas),0_0_0_4px_var(--gr-focus)] " +
  "[&::-webkit-slider-runnable-track]:h-4 [&::-webkit-slider-runnable-track]:bg-transparent " +
  "[&::-moz-range-track]:bg-transparent";

/**
 * Ползунок на нативном <input type="range">: клавиатура (стрелки, PageUp/Down,
 * Home/End) и скринридеры работают сами. Дорожка и заливка — свои элементы
 * под прозрачным input, поэтому вид одинаков в Chrome и Firefox.
 */
export function Slider({
  ref,
  id,
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  showValue = true,
  formatValue = (v) => String(v),
  marks,
  snap,
  iconStart,
  iconEnd,
  variant = "default",
  className,
  wrapperClassName,
  disabled,
  onKeyDown,
  onPointerDown,
  ...props
}: SliderProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const text = formatValue(value);
  const look = VARIANT[variant];
  // Чем двигают: магнит к риске — только для мыши и пальца (см. sliderValue).
  const keyboardRef = useRef(false);

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", disabled && "opacity-50", wrapperClassName)}>
      {label && (
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={inputId} className="text-label font-medium text-ink-2">
            {label}
          </label>
          {showValue && <span className="text-label font-medium tabular-nums text-ink">{text}</span>}
        </div>
      )}
      <div className="flex items-center gap-2.5">
        {iconStart && <Icon name={iconStart} size={16} className="shrink-0 text-ink-3" />}
        <div className="relative flex h-5 min-w-0 flex-1 items-center">
          <span aria-hidden="true" className={cn("absolute inset-x-0 h-1 rounded-full", look.track)} />
          <span
            aria-hidden="true"
            className={cn("absolute left-0 h-1 rounded-full", look.fill)}
            style={{ width: `${pct}%` }}
          />
          {marks?.map((m) => (
            <span
              key={m}
              aria-hidden="true"
              className={cn("absolute h-2.5 w-0.5 -translate-x-1/2 rounded-full", look.mark)}
              style={{ left: `${((m - min) / (max - min)) * 100}%` }}
            />
          ))}
          <input
            ref={ref}
            id={inputId}
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={disabled}
            aria-valuetext={text}
            onKeyDown={(e) => {
              keyboardRef.current = true;
              onKeyDown?.(e);
            }}
            onPointerDown={(e) => {
              keyboardRef.current = false;
              onPointerDown?.(e);
            }}
            onChange={(e) =>
              onValueChange(
                sliderValue(Number(e.target.value), {
                  marks,
                  snap,
                  input: keyboardRef.current ? "keyboard" : "pointer",
                }),
              )
            }
            className={cn(
              "relative h-4 w-full cursor-pointer appearance-none bg-transparent focus-visible:outline-0 disabled:cursor-not-allowed",
              THUMB,
              look.thumb,
              className,
            )}
            {...props}
          />
        </div>
        {iconEnd && <Icon name={iconEnd} size={16} className="shrink-0 text-ink-3" />}
      </div>
    </div>
  );
}

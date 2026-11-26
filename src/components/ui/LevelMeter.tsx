"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "./cn";
import {
  dbToFraction,
  formatDb,
  fractionToDb,
  METER_MAX_DB,
  METER_MIN_DB,
  nextPeak,
  smoothLevelDb,
  type PeakState,
} from "./level";

/** Режим порога: авто (двигает приложение), вручную (тянет человек), выкл. */
export type GateMode = "auto" | "manual" | "off";

export type LevelMeterProps = {
  /** Уровень в дБFS для статичного показа (макеты, тесты). */
  levelDb?: number;
  /**
   * Живой источник уровня (дБFS). Опрашивается в requestAnimationFrame, пока
   * индикатор на экране, — React при этом не перерисовывается.
   */
  getLevelDb?: () => number;
  /** Порог, дБFS. Справа от него звук проходит в эфир (полоса signal). */
  thresholdDb?: number;
  onThresholdChange?: (db: number) => void;
  mode?: GateMode;
  minDb?: number;
  maxDb?: number;
  size?: "sm" | "md";
  /** Подпись полосы для скринридера. */
  label?: string;
  className?: string;
};

// Стартовое положение заливок. Именно transform, а не утилита scale-x-0:
// в Tailwind 4 она пишет свойство `scale`, которое умножилось бы на transform.
const ZERO = { transform: "scaleX(0)" } as const;

/** Выше этого уровня — «горячо», близко к перегрузу (caution). */
const HOT_DB = -6;
// Сегменты «как у пульта»: 4px деление, 2px зазор. Маска статична, двигаются
// только заливки (transform), поэтому сегменты не «плывут».
const SEGMENTS = "[mask-image:repeating-linear-gradient(90deg,#000_0_4px,transparent_4px_6px)]";

/**
 * Полоса уровня микрофона с порогом. Серым — то, что отсекается, signal —
 * что уходит в эфир, caution — близко к перегрузу. В режиме «Вручную»
 * порог тянется мышью по полосе или стрелками (←/→ по 1 дБ, PageUp/Down по
 * 6 дБ); в «Авто» маркер показан, но не двигается; в «Выкл» маркера нет и
 * вся полоса — signal (проходит всё).
 */
export function LevelMeter({
  levelDb,
  getLevelDb,
  thresholdDb = -45,
  onThresholdChange,
  mode = onThresholdChange ? "manual" : "auto",
  minDb = METER_MIN_DB,
  maxDb = METER_MAX_DB,
  size = "md",
  label = "Уровень микрофона",
  className,
}: LevelMeterProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const peakRef = useRef<HTMLSpanElement>(null);
  const sourceRef = useRef(getLevelDb);
  const [dragging, setDragging] = useState(false);
  const live = typeof getLevelDb === "function";

  useLayoutEffect(() => {
    sourceRef.current = getLevelDb;
  });

  // Рисуем уровень напрямую в style: transform у трёх заливок и метки пика.
  const paint = (db: number, peakDb: number) => {
    const f = dbToFraction(db, minDb, maxDb);
    for (const el of fillRefs.current) if (el) el.style.transform = `scaleX(${f})`;
    const p = peakRef.current;
    if (p) {
      const pf = dbToFraction(peakDb, minDb, maxDb);
      p.style.opacity = pf > 0.01 ? "1" : "0";
      p.style.left = `calc(${pf * 100}% - 1px)`;
    }
  };
  const paintRef = useRef(paint);
  useLayoutEffect(() => {
    paintRef.current = paint;
  });

  // Статичный уровень.
  useLayoutEffect(() => {
    if (live) return;
    paintRef.current(levelDb ?? -Infinity, levelDb ?? -Infinity);
  }, [live, levelDb]);

  // Живой уровень: rAF только пока смонтирован; в скрытой вкладке rAF спит сам.
  useEffect(() => {
    if (!live) return;
    let raf = 0;
    let last = performance.now();
    let shown = -Infinity;
    let peak: PeakState = { db: -Infinity, heldMs: 0 };
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      const target = sourceRef.current?.() ?? -Infinity;
      shown = smoothLevelDb(shown, target, dt);
      peak = nextPeak(peak, shown, dt);
      paintRef.current(shown, peak.db);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live]);

  const interactive = mode === "manual" && !!onThresholdChange;
  const tf = mode === "off" ? 0 : dbToFraction(thresholdDb, minDb, maxDb);
  const hf = dbToFraction(HOT_DB, minDb, maxDb);

  function setFromPointer(clientX: number) {
    const el = trackRef.current;
    if (!el || !onThresholdChange) return;
    const r = el.getBoundingClientRect();
    const db = Math.round(fractionToDb((clientX - r.left) / r.width, minDb, maxDb));
    onThresholdChange(db);
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!interactive || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    setFromPointer(e.clientX);
  }

  function onKeyDown(e: KeyboardEvent<HTMLSpanElement>) {
    if (!interactive || !onThresholdChange) return;
    const step: Record<string, number> = {
      ArrowRight: 1,
      ArrowUp: 1,
      ArrowLeft: -1,
      ArrowDown: -1,
      PageUp: 6,
      PageDown: -6,
    };
    let next: number | null = null;
    if (e.key in step) next = thresholdDb + step[e.key];
    else if (e.key === "Home") next = minDb;
    else if (e.key === "End") next = maxDb;
    if (next === null) return;
    e.preventDefault();
    onThresholdChange(Math.min(maxDb, Math.max(minDb, Math.round(next))));
  }

  const h = size === "md" ? "h-3" : "h-2";

  return (
    <div className={cn("relative select-none py-2", className)}>
      <div
        ref={trackRef}
        role="group"
        aria-label={label}
        onPointerDown={onPointerDown}
        onPointerMove={(e) => {
          if (dragging) setFromPointer(e.clientX);
        }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        className={cn("relative w-full", h, interactive && "cursor-ew-resize touch-none")}
      >
        <div aria-hidden="true" className={cn("absolute inset-0 overflow-hidden rounded-[3px]", SEGMENTS)}>
          <span className="absolute inset-0 bg-wash-3" />
          {/* ниже порога — отсекается */}
          <span
            ref={(el) => {
              fillRefs.current[0] = el;
            }}
            className="absolute inset-0 origin-left bg-ink-3/70"
            style={ZERO}
          />
          {/* выше порога — уходит в эфир */}
          <span className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${tf * 100}%)` }}>
            <span
              ref={(el) => {
                fillRefs.current[1] = el;
              }}
              className="absolute inset-0 origin-left bg-signal"
              style={ZERO}
            />
          </span>
          {/* почти перегруз */}
          <span className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${hf * 100}%)` }}>
            <span
              ref={(el) => {
                fillRefs.current[2] = el;
              }}
              className="absolute inset-0 origin-left bg-caution"
              style={ZERO}
            />
          </span>
        </div>
        {/* метка пика */}
        <span
          ref={peakRef}
          aria-hidden="true"
          className="absolute inset-y-0 w-0.5 rounded-full bg-ink opacity-0"
        />
        {mode !== "off" && (
          <span
            role={interactive ? "slider" : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-label={interactive ? "Порог чувствительности" : undefined}
            aria-valuemin={interactive ? minDb : undefined}
            aria-valuemax={interactive ? maxDb : undefined}
            aria-valuenow={interactive ? Math.round(thresholdDb) : undefined}
            aria-valuetext={interactive ? formatDb(thresholdDb) : undefined}
            aria-hidden={interactive ? undefined : true}
            onKeyDown={onKeyDown}
            className={cn(
              "group absolute -inset-y-2 -ml-[9px] flex w-[18px] justify-center focus-visible:outline-offset-0",
              "rounded-full",
              interactive ? "cursor-ew-resize" : "pointer-events-none",
            )}
            style={{ left: `${tf * 100}%` }}
          >
            <span
              className={cn(
                "h-full w-0.5 rounded-full",
                interactive ? "bg-ink" : "bg-ink-2 [mask-image:repeating-linear-gradient(180deg,#000_0_3px,transparent_3px_5px)]",
              )}
            />
            <span
              className={cn(
                "absolute -top-1.5 size-3 rounded-full border-2",
                interactive
                  ? "border-ink bg-canvas transition-transform duration-140 group-hover:scale-125 group-focus-visible:scale-125"
                  : "border-ink-2 bg-canvas",
                dragging && "scale-125",
              )}
            />
            {(dragging || interactive) && (
              <span
                className={cn(
                  "pointer-events-none absolute -top-8 whitespace-nowrap rounded-key bg-overlay px-1.5 py-0.5 text-caption font-medium tabular-nums text-ink shadow-float",
                  "opacity-0 transition-opacity duration-140 group-hover:opacity-100 group-focus-visible:opacity-100",
                  dragging && "opacity-100",
                )}
              >
                {formatDb(thresholdDb)}
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

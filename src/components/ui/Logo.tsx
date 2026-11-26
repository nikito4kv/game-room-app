import { useId } from "react";
import { cn } from "./cn";

// Логотип «game room». Буквы — своя монолинейная геометрия (x-высота 14,
// штрих 3.4, круглые окончания), а не набор шрифтом: SVG одинаков везде и
// не ждёт загрузки шрифта. Второе «о» в «room» — залитый круг цвета signal:
// «в комнате кто-то говорит». Знак — кольцо и круг внахлёст с вырезом, как
// стопка аватаров: двое, один говорит. Те же файлы лежат в public/brand/.

const SW = 3.4;

/** Буквы без «сигнального» круга. viewBox: 0 5.5 142 22. */
const WORD_PATHS = [
  // g
  "M12.3 7.7V20a5.3 5.3 0 0 1-7.95 4.59",
  // a
  "M28.9 7.7V18.3",
  // m
  "M34.9 18.3V7.7M34.9 11.7a4 4 0 0 1 8 0V18.3M42.9 11.7a4 4 0 0 1 8 0V18.3",
  // e
  "M56.9 13H67.5A5.3 5.3 0 1 0 65.95 16.75",
  // r
  "M77.9 18.3V7.7M77.9 13a5.3 5.3 0 0 1 7.11-4.98",
  // m
  "M123.6 18.3V7.7M123.6 11.7a4 4 0 0 1 8 0V18.3M131.6 11.7a4 4 0 0 1 8 0V18.3",
];
const WORD_RINGS = [
  { cx: 7, cy: 13 }, // g
  { cx: 23.6, cy: 13 }, // a
  { cx: 95.7, cy: 13 }, // o
];

function Wordmark({
  height,
  className,
  title,
  style,
}: {
  height: number;
  className?: string;
  title?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      viewBox="-0.5 5.5 142.3 22"
      height={height}
      width={(height * 142.3) / 22}
      className={className}
      style={style}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <g fill="none" stroke="currentColor" strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round">
        {WORD_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
        {WORD_RINGS.map((c) => (
          <circle key={c.cx} cx={c.cx} cy={c.cy} r={5.3} />
        ))}
      </g>
      <circle cx={112.3} cy={13} r={7} fill="var(--gr-signal, #bcf736)" />
    </svg>
  );
}

function Mark({ size, className, title }: { size: number; className?: string; title?: string }) {
  const maskId = useId();
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <mask id={maskId}>
        <rect width="32" height="32" fill="#fff" />
        <circle cx="22" cy="16" r="10.1" fill="#000" />
      </mask>
      <circle
        cx="10"
        cy="16"
        r="6.8"
        fill="none"
        stroke="currentColor"
        strokeWidth={SW}
        mask={`url(#${maskId})`}
      />
      <circle cx="22" cy="16" r="8.5" fill="var(--gr-signal, #bcf736)" />
    </svg>
  );
}

/**
 * Логотип. variant: mark — только знак (шапка комнаты, фавикон), wordmark —
 * надпись, lockup — знак + надпись (лендинг). Цвет линий — currentColor.
 */
export function Logo({
  variant = "lockup",
  height = 24,
  className,
  title = "Game Room",
}: {
  variant?: "mark" | "wordmark" | "lockup";
  /** Высота знака/надписи в px. */
  height?: number;
  className?: string;
  /** Подпись для скринридера; пустая строка — декоративный логотип. */
  title?: string;
}) {
  if (variant === "mark") return <Mark size={height} className={className} title={title || undefined} />;
  if (variant === "wordmark") return <Wordmark height={height} className={className} title={title || undefined} />;
  const wordHeight = Math.round(height * 0.62);
  return (
    <span
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      className={cn("inline-flex items-center", className)}
      style={{ gap: Math.round(height * 0.32) }}
    >
      <Mark size={height} />
      {/* Центр строчных букв выше центра рамки (под ней хвост «g») — опускаем
          надпись, чтобы буквы стояли ровно по центру знака. */}
      <Wordmark height={wordHeight} className="relative" style={{ top: Math.round(wordHeight * 0.16) }} />
    </span>
  );
}

import { cn } from "./cn";

export type ConnectionQuality = "excellent" | "good" | "poor" | "lost" | "unknown";

const LABEL: Record<ConnectionQuality, string> = {
  excellent: "отличная",
  good: "хорошая",
  poor: "слабая",
  lost: "нет связи",
  unknown: "проверяем",
};

const ACTIVE: Record<ConnectionQuality, number> = { excellent: 3, good: 2, poor: 1, lost: 0, unknown: 0 };

/**
 * Качество связи — три столбика. Пока всё хорошо, они серые и не зовут
 * взгляд; цвет появляется только при проблеме (caution, alert).
 */
export function SignalBars({
  quality,
  className,
  label,
}: {
  quality: ConnectionQuality;
  className?: string;
  /** Подпись для скринридера; по умолчанию «Связь: отличная». "" — декоративные (текст рядом). */
  label?: string;
}) {
  const on = ACTIVE[quality];
  const tone =
    quality === "poor" ? "bg-caution" : quality === "lost" ? "bg-alert-ink" : "bg-ink-2";
  return (
    <span
      role={label === "" ? undefined : "img"}
      aria-label={label === "" ? undefined : (label ?? `Связь: ${LABEL[quality]}`)}
      aria-hidden={label === "" ? true : undefined}
      className={cn("inline-flex h-3 items-end gap-[2px]", className)}
    >
      {[5, 8, 11].map((h, i) => (
        <span
          key={h}
          className={cn(
            "w-[3px] rounded-[1px]",
            i < on ? tone : quality === "lost" ? "bg-alert-ink/35" : "bg-wash-3",
          )}
          style={{ height: h }}
        />
      ))}
    </span>
  );
}

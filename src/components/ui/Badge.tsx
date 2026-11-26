import type { ReactNode } from "react";
import { cn } from "./cn";
import { Icon, type IconName } from "./icons";

export type BadgeTone = "neutral" | "signal" | "alert" | "caution" | "crown";
export type BadgeVariant = "soft" | "solid" | "outline";

const SOFT: Record<BadgeTone, string> = {
  neutral: "bg-wash-2 text-ink-2",
  signal: "bg-signal-wash text-signal-ink",
  alert: "bg-alert-wash text-alert-ink",
  caution: "bg-caution-wash text-caution-ink",
  crown: "bg-[color-mix(in_srgb,var(--gr-crown)_14%,transparent)] text-crown",
};

const SOLID: Record<BadgeTone, string> = {
  neutral: "bg-ink text-inverse",
  signal: "bg-signal text-on-signal",
  alert: "bg-alert text-on-alert",
  caution: "bg-caution text-on-caution",
  crown: "bg-crown text-on-caution",
};

const OUTLINE: Record<BadgeTone, string> = {
  neutral: "border border-line-strong text-ink-2",
  signal: "border border-signal/45 text-signal-ink",
  alert: "border border-alert-ink/45 text-alert-ink",
  caution: "border border-caution/45 text-caution-ink",
  crown: "border border-crown/45 text-crown",
};

/**
 * Короткая метка: «Эфир», «Хост», «Закрыта», счётчик непрочитанных.
 * Тон — по смыслу (см. токены): signal — передаёт, alert — не слышно/опасно,
 * caution — внимание, crown — хост. Не для декора.
 */
export function Badge({
  children,
  tone = "neutral",
  variant = "soft",
  size = "md",
  icon,
  caps = false,
  className,
}: {
  children?: ReactNode;
  tone?: BadgeTone;
  variant?: BadgeVariant;
  size?: "sm" | "md";
  icon?: IconName;
  /** Заглавными с разрядкой — для коротких статусов вроде «ЭФИР». */
  caps?: boolean;
  className?: string;
}) {
  const palette = variant === "solid" ? SOLID : variant === "outline" ? OUTLINE : SOFT;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-semibold tabular-nums",
        size === "sm" ? "h-5 px-1.5 text-micro" : "h-6 px-2 text-caption",
        caps && "uppercase tracking-[0.06em]",
        palette[tone],
        className,
      )}
    >
      {icon && <Icon name={icon} size={size === "sm" ? 12 : 14} />}
      {children}
    </span>
  );
}

/** Счётчик на иконке (непрочитанные). 1–9, дальше «9+». */
export function CountBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "pointer-events-none inline-grid h-[18px] min-w-[18px] place-items-center rounded-full bg-ink px-1 text-micro font-bold text-inverse tabular-nums",
        "shadow-[0_0_0_2px_var(--gr-raised)]",
        className,
      )}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

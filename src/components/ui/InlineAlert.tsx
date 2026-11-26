import type { ReactNode } from "react";
import { cn } from "./cn";
import { Icon, type IconName } from "./icons";

export type InlineAlertTone = "info" | "caution" | "alert" | "success";

const TONE: Record<InlineAlertTone, { box: string; icon: string; name: IconName }> = {
  info: { box: "bg-wash-1 border-line", icon: "text-ink-2", name: "info" },
  caution: { box: "bg-caution-wash border-caution/30", icon: "text-caution-ink", name: "alert-triangle" },
  alert: { box: "bg-alert-wash border-alert-ink/35", icon: "text-alert-ink", name: "alert-circle" },
  success: { box: "bg-signal-wash border-signal/25", icon: "text-signal-ink", name: "check-circle" },
};

/**
 * Сообщение прямо в потоке экрана: «Нет доступа к микрофону», «Клавиши
 * работают только в активной вкладке». Цвет — только у иконки и подложки,
 * текст остаётся ink/ink-2 (контраст AA). Для кратких событий — тосты.
 */
export function InlineAlert({
  tone = "info",
  title,
  children,
  action,
  onDismiss,
  icon,
  className,
}: {
  tone?: InlineAlertTone;
  title?: ReactNode;
  children?: ReactNode;
  /** Кнопка-действие справа (например, «Попробовать снова»). */
  action?: ReactNode;
  /** Показать крестик «Скрыть». */
  onDismiss?: () => void;
  icon?: IconName;
  className?: string;
}) {
  const t = TONE[tone];
  return (
    <div
      role={tone === "alert" ? "alert" : "status"}
      className={cn("flex items-start gap-3 rounded-card border px-3.5 py-3 text-body", t.box, className)}
    >
      <Icon name={icon ?? t.name} size={18} className={cn("mt-px shrink-0", t.icon)} />
      {/* Узко (карточка лобби, телефон) — кнопка уходит под текст, а не сжимает
          его в столбик в два слова шириной; широко — стоит справа. */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-[1_1_15rem]">
          {title && <p className="font-medium text-ink">{title}</p>}
          {children && <div className={cn("text-ink-2", title ? "mt-0.5" : undefined)}>{children}</div>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Скрыть"
          className="-m-1 grid size-7 shrink-0 place-items-center rounded-item text-ink-3 transition-colors duration-140 hover:bg-wash-2 hover:text-ink"
        >
          <Icon name="x" size={16} />
        </button>
      )}
    </div>
  );
}

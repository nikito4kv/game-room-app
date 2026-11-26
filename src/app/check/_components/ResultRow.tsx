import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Icon, type IconName } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/Spinner";
import type { RowTone, RowView } from "../_lib/present";

const TONE_ICON: Record<RowTone, { icon: IconName; color: string; badge: BadgeTone }> = {
  ok: { icon: "check-circle", color: "text-signal-ink", badge: "signal" },
  warn: { icon: "alert-triangle", color: "text-caution-ink", badge: "caution" },
  bad: { icon: "alert-circle", color: "text-alert-ink", badge: "alert" },
  skip: { icon: "minus", color: "text-ink-3", badge: "neutral" },
};

export type RowState = "pending" | "running" | RowView;

/**
 * Одна строка результата: значок состояния, название, пояснение и метка справа.
 * Цвет несёт смысл, как во всей системе: зелёный «хорошо», жёлтый «внимание»,
 * красный «плохо», серый «не проверялось».
 */
export function ResultRow({ title, state }: { title: ReactNode; state: RowState }) {
  const view = typeof state === "object" ? state : null;
  const tone = view ? TONE_ICON[view.tone] : null;
  return (
    <li className="flex items-start gap-3 py-3">
      <span className="mt-0.5 grid size-5 shrink-0 place-items-center" aria-hidden="true">
        {state === "running" ? (
          <Spinner size={18} className="text-ink-2" />
        ) : tone ? (
          <Icon name={tone.icon} size={20} className={tone.color} />
        ) : (
          <span className="size-2 rounded-full bg-wash-3" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="text-body font-medium text-ink">{title}</p>
          <Badge tone={tone?.badge ?? "neutral"} size="sm">
            {view ? view.badge : state === "running" ? "Идёт" : "Ждёт"}
          </Badge>
        </div>
        {view && <p className="mt-0.5 text-label text-ink-3">{view.detail}</p>}
      </div>
    </li>
  );
}

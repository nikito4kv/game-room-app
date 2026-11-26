"use client";

import { useMemo, useState } from "react";
import { cn } from "@/components/ui/cn";
import { Icon, type IconName } from "@/components/ui/icons";
import type { AnnouncementLevel } from "@/lib/api/platform";
import {
  canDismissForever,
  dismissAnnouncementForever,
  getDismissedAnnouncements,
  visibleAnnouncements,
} from "@/lib/client/announcements";
import { usePublicConfig } from "@/lib/client/usePublicConfig";

const LEVEL: Record<AnnouncementLevel, { box: string; icon: string; name: IconName; label: string }> = {
  info: { box: "bg-wash-1 border-line", icon: "text-ink-2", name: "info", label: "Объявление" },
  warning: { box: "bg-caution-wash border-caution/25", icon: "text-caution-ink", name: "alert-triangle", label: "Внимание" },
  critical: { box: "bg-alert-wash border-alert-ink/30", icon: "text-alert-ink", name: "alert-circle", label: "Важно" },
};

/**
 * Объявления администрации (А3): полосой во всю ширину над страницей — на сайте
 * (room не задан) и в комнате (room = код). Закрыли крестиком — больше не
 * показываем (id в localStorage); критическое закрывается только до перезагрузки.
 * Объявлений нет — ничего не рисует.
 */
export function AnnouncementBar({ room, className }: { room?: string; className?: string }) {
  const config = usePublicConfig(room);
  // Закрытые: из хранилища (навсегда) и в этой вкладке (критические).
  const [dismissed, setDismissed] = useState<string[]>(() =>
    typeof window === "undefined" ? [] : getDismissedAnnouncements(),
  );
  const list = useMemo(
    () => visibleAnnouncements(config?.announcements ?? [], dismissed),
    [config, dismissed],
  );
  if (list.length === 0) return null;

  return (
    <div className={cn("flex shrink-0 flex-col", className)} data-testid="announcements">
      {list.map((a) => {
        const l = LEVEL[a.level];
        return (
          <div
            key={a.id}
            role={a.level === "critical" ? "alert" : "status"}
            className={cn("border-b", l.box)}
            data-level={a.level}
          >
            <div className="mx-auto flex w-full max-w-[1200px] items-start gap-2.5 px-5 py-2.5 text-body text-ink">
              <Icon name={l.name} size={18} className={cn("mt-px shrink-0", l.icon)} />
              <p className="min-w-0 flex-1 text-pretty">
                <span className="sr-only">{l.label}: </span>
                {a.text}
              </p>
              <button
                type="button"
                aria-label="Скрыть объявление"
                onClick={() => {
                  if (canDismissForever(a.level)) dismissAnnouncementForever(a.id);
                  setDismissed((d) => [...d, a.id]);
                }}
                className="-my-1 -mr-1.5 grid size-7 shrink-0 place-items-center rounded-item text-ink-3 transition-colors duration-140 hover:bg-wash-2 hover:text-ink"
              >
                <Icon name="x" size={16} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

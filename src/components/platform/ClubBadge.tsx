import type { CSSProperties } from "react";
import { cn } from "@/components/ui/cn";
import { Icon } from "@/components/ui/icons";
import type { RoomBadge } from "@/lib/api/platform";
import { badgeTextColor } from "@/lib/client/badgeColor";

/**
 * Бейдж клуба на комнате, созданной по ключу (А6): название клуба на его цвете,
 * текст — чёрный или белый, что контрастнее. Без цвета — нейтральный контурный
 * бейдж. Форма и размеры — как у Badge дизайн-системы (цвет у того задан токенами,
 * поэтому здесь своя обёртка).
 */
export function ClubBadge({ badge, size = "sm", className }: { badge: RoomBadge; size?: "sm" | "md"; className?: string }) {
  const ink = badge.color ? badgeTextColor(badge.color) : null;
  const style: CSSProperties | undefined = badge.color && ink ? { backgroundColor: badge.color, color: ink } : undefined;
  return (
    <span
      data-testid="club-badge"
      title={`Комната клуба «${badge.label}»`}
      style={style}
      className={cn(
        "inline-flex min-w-0 max-w-[16rem] shrink items-center gap-1 whitespace-nowrap rounded-full font-semibold",
        size === "sm" ? "h-5 px-1.5 text-micro" : "h-6 px-2 text-caption",
        !style && "border border-line-strong text-ink-2",
        className,
      )}
    >
      <Icon name="shield" size={size === "sm" ? 12 : 14} className="shrink-0" />
      <span className="sr-only">Клуб: </span>
      <span className="truncate">{badge.label}</span>
    </span>
  );
}

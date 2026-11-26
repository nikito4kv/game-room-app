import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * Строка настройки: слева название и пояснение, справа контрол (Switch,
 * Select, кнопка). Если передан htmlFor — клик по названию переключает
 * контрол (у Switch задайте тот же id).
 *
 * Группу строк кладите в контейнер с `divide-y divide-line` — без карточек
 * внутри карточек.
 */
export function SettingRow({
  title,
  description,
  htmlFor,
  control,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  htmlFor?: string;
  control: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-4 py-3", className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="cursor-pointer text-body text-ink">
            {title}
          </label>
        ) : (
          <span className="text-body text-ink">{title}</span>
        )}
        {description && <span className="text-label text-ink-3">{description}</span>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

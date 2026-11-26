import type { ReactNode } from "react";
import { cn } from "./cn";
import { Icon, type IconName } from "./icons";

/**
 * Пустое состояние: что здесь будет и как это получить. Всегда с
 * действием, если пользователь может что-то сделать («Скопировать ссылку»).
 *
 * Заголовок — h3 (внутри панели с h2, как в чате). Прямо под h1 страницы
 * передайте `titleAs="h2"`, иначе уровень заголовка перепрыгнет (axe heading-order).
 */
export function EmptyState({
  icon,
  visual,
  title,
  description,
  actions,
  size = "md",
  titleAs: Title = "h3",
  className,
}: {
  icon?: IconName;
  /** Своя картинка вместо иконки (например, стопка аватаров). */
  visual?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  size?: "sm" | "md";
  titleAs?: "h2" | "h3";
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center text-center", size === "sm" ? "gap-2" : "gap-3", className)}>
      {visual ??
        (icon && (
          <span
            className={cn(
              "grid place-items-center rounded-full bg-wash-2 text-ink-2",
              size === "sm" ? "mb-1 size-10" : "mb-2 size-14",
            )}
          >
            <Icon name={icon} size={size === "sm" ? 20 : 26} />
          </span>
        ))}
      <Title className={cn("text-balance text-ink", size === "sm" ? "text-title" : "font-brand text-heading")}>
        {title}
      </Title>
      {description && (
        <p className={cn("max-w-[44ch] text-pretty text-ink-2", size === "sm" ? "text-label" : "text-body")}>
          {description}
        </p>
      )}
      {actions && <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </div>
  );
}

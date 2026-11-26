import type { ReactNode, Ref, SelectHTMLAttributes } from "react";
import { cn } from "./cn";
import { CONTROL_CLASS, FieldShell, useFieldIds } from "./Field";
import { Icon, type IconName } from "./icons";

export type SelectOption = { value: string; label: string; disabled?: boolean };

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
  ref?: Ref<HTMLSelectElement>;
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Иконка слева (mic, headphones…). */
  icon?: IconName;
  /** Варианты списком. Можно и детьми <option>. */
  options?: SelectOption[];
  size?: "sm" | "md";
  wrapperClassName?: string;
};

/**
 * Выпадающий список на нативном <select>: клавиатура, скринридеры и длинные
 * названия устройств работают «из коробки», список открывается тёмным
 * (color-scheme из токенов). Закрытое состояние оформлено как поле ввода.
 * Длинное название в закрытом поле обрезается «…» — полное видно в подсказке
 * при наведении (title с подписью выбранного варианта).
 */
export function Select({
  ref,
  id,
  label,
  hint,
  error,
  icon,
  options,
  size = "md",
  className,
  wrapperClassName,
  children,
  title,
  ...props
}: SelectProps) {
  const ids = useFieldIds(id);
  const describedBy = error ? ids.errorId : hint ? ids.hintId : undefined;
  const chosen = options?.find((o) => o.value === props.value)?.label;
  return (
    <FieldShell label={label} hint={hint} error={error} {...ids} className={wrapperClassName}>
      <div className="relative flex items-center">
        {icon && (
          <Icon name={icon} size={18} className="pointer-events-none absolute left-3 text-ink-3" />
        )}
        <select
          ref={ref}
          id={ids.inputId}
          title={title ?? chosen}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            CONTROL_CLASS,
            "cursor-pointer appearance-none truncate pr-9",
            size === "sm" ? "h-8 pl-2.5 text-label" : "h-10 pl-3 text-body",
            icon && "pl-9",
            className,
          )}
          {...props}
        >
          {options?.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
          {children}
        </select>
        <Icon
          name="chevron-down"
          size={16}
          className="pointer-events-none absolute right-3 text-ink-3"
        />
      </div>
    </FieldShell>
  );
}

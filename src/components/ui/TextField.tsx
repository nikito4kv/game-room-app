import type { InputHTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "./cn";
import { CONTROL_CLASS, FieldShell, useFieldIds } from "./Field";
import { Icon, type IconName } from "./icons";

export type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  ref?: Ref<HTMLInputElement>;
  label?: ReactNode;
  hint?: ReactNode;
  /** Текст ошибки: красная рамка + сообщение под полем, aria-invalid. */
  error?: ReactNode;
  /** Иконка внутри поля слева. */
  icon?: IconName;
  /** Слот справа внутри поля: кнопка «Копировать», Kbd, счётчик. */
  suffix?: ReactNode;
  size?: "md" | "lg";
  /** Класс обёртки (ширина, отступы). className — у самого <input>. */
  wrapperClassName?: string;
};

/** Поле ввода с подписью, подсказкой и ошибкой. */
export function TextField({
  ref,
  id,
  label,
  hint,
  error,
  icon,
  suffix,
  size = "md",
  className,
  wrapperClassName,
  ...props
}: TextFieldProps) {
  const ids = useFieldIds(id);
  const describedBy = error ? ids.errorId : hint ? ids.hintId : undefined;
  return (
    <FieldShell label={label} hint={hint} error={error} {...ids} className={wrapperClassName}>
      <div className="relative flex items-center">
        {icon && (
          <Icon
            name={icon}
            size={size === "lg" ? 20 : 18}
            className="pointer-events-none absolute left-3 text-ink-3"
          />
        )}
        <input
          ref={ref}
          id={ids.inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            CONTROL_CLASS,
            size === "lg" ? "h-12 px-4 text-body-lg" : "h-10 px-3 text-body-lg",
            icon && (size === "lg" ? "pl-11" : "pl-9"),
            suffix ? "pr-12" : undefined,
            className,
          )}
          {...props}
        />
        {suffix && <div className="absolute right-1.5 flex items-center gap-1">{suffix}</div>}
      </div>
    </FieldShell>
  );
}

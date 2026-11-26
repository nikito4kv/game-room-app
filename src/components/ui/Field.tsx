import { useId, type ReactNode } from "react";
import { cn } from "./cn";
import { Icon } from "./icons";

/** id для поля и его подсказок — чтобы связать label/aria-describedby. */
export function useFieldIds(id?: string) {
  const auto = useId();
  const base = id ?? auto;
  return { inputId: base, hintId: `${base}-hint`, errorId: `${base}-error` };
}

/**
 * Обвязка поля: подпись сверху, контрол, под ним подсказка или ошибка.
 * Плейсхолдер подпись не заменяет никогда.
 */
export function FieldShell({
  label,
  hint,
  error,
  inputId,
  hintId,
  errorId,
  className,
  children,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  inputId: string;
  hintId: string;
  errorId: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={inputId} className="text-label font-medium text-ink-2">
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p id={errorId} className="flex items-start gap-1.5 text-caption text-alert-ink">
          <Icon name="alert-circle" size={14} className="mt-px shrink-0" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={hintId} className="text-caption text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Общий вид поля ввода и select — одна высота, рамка, фокус. */
export const CONTROL_CLASS =
  "w-full min-w-0 rounded-control border border-line-strong bg-sunken text-ink " +
  "transition-[border-color,background-color] duration-140 ease-swift " +
  "hover:border-line-control focus-visible:border-focus focus-visible:outline-offset-[-1px] " +
  "aria-invalid:border-alert-ink/70 disabled:cursor-not-allowed disabled:opacity-50";

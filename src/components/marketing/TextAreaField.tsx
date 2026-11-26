"use client";

import type { ReactNode, Ref, TextareaHTMLAttributes } from "react";
import { cn } from "@/components/ui/cn";
import { CONTROL_CLASS, FieldShell, useFieldIds } from "@/components/ui/Field";

/**
 * Многострочное поле с подписью, подсказкой, ошибкой и счётчиком «12/300».
 * В примитивах `@/components/ui` такого поля пока нет, поэтому оно здесь: те же
 * подпись, рамка и фокус (FieldShell, CONTROL_CLASS), что у TextField.
 */
export function TextAreaField({
  ref,
  id,
  label,
  hint,
  error,
  value,
  maxLength,
  rows = 3,
  className,
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value"> & {
  ref?: Ref<HTMLTextAreaElement>;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  value: string;
  /** Предел в символах; считаем кодовые точки, как сервер. */
  maxLength: number;
}) {
  const ids = useFieldIds(id);
  const count = [...value].length;
  const describedBy = error ? ids.errorId : ids.hintId;
  return (
    <FieldShell
      label={label}
      error={error}
      hint={
        <span className="flex items-start justify-between gap-3">
          <span>{hint}</span>
          <span className={cn("shrink-0 tabular-nums", count > maxLength && "text-alert-ink")}>
            {count}/{maxLength}
          </span>
        </span>
      }
      {...ids}
    >
      <textarea
        ref={ref}
        id={ids.inputId}
        value={value}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(CONTROL_CLASS, "min-h-[88px] resize-y px-3 py-2.5 text-body-lg", className)}
        {...props}
      />
    </FieldShell>
  );
}

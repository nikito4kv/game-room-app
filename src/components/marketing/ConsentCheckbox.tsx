"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/icons";

/**
 * Согласие на обработку данных заявки: галочка и ссылка на политику. Настоящий
 * <input type="checkbox"> (клавиатура, скринридер, форма), поверх него наша
 * рамка. Ссылка открывается в новой вкладке, чтобы не потерять заполненное.
 * Отдельного примитива-чекбокса в `@/components/ui` пока нет.
 */
export function ConsentCheckbox({
  id,
  checked,
  onChange,
  purpose,
  error,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Зачем берём данные: «чтобы мне ответили на заявку». */
  purpose: string;
  error?: string;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-key border border-line-control bg-sunken text-inverse transition-colors duration-140 peer-checked:border-ink peer-checked:bg-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus peer-aria-invalid:border-alert-ink/70 [&>svg]:opacity-0 peer-checked:[&>svg]:opacity-100"
        >
          <Icon name="check" size={14} strokeWidth={3} />
        </span>
        <span className="text-label text-ink-2">
          Даю согласие на обработку данных заявки (имени, сообщения и контакта, если он указан), {purpose}. Подробнее в{" "}
          <Link href="/privacy" target="_blank" rel="noopener" className="text-ink underline underline-offset-4 hover:text-ink-2">
            политике конфиденциальности
          </Link>
          .
        </span>
      </label>
      {error && (
        <p id={errorId} className="flex items-start gap-1.5 pl-8 text-caption text-alert-ink">
          <Icon name="alert-circle" size={14} className="mt-px shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

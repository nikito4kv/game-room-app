"use client";

import { useEffect, useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { cn } from "./cn";
import { IconButton } from "./IconButton";
import { firstFocusable } from "./useFloating";

export type DialogSize = "sm" | "md" | "lg" | "xl";

const WIDTH: Record<DialogSize, string> = {
  sm: "sm:max-w-[400px]",
  md: "sm:max-w-[520px]",
  lg: "sm:max-w-[720px]",
  xl: "sm:max-w-[880px]",
};

export type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Скрыть заголовок визуально (для скринридера он остаётся). */
  hideTitle?: boolean;
  children: ReactNode;
  /** Кнопки внизу: Отмена / Сохранить. */
  footer?: ReactNode;
  /**
   * Своя кнопка в шапке справа вместо крестика: маленькая «Готово» у окна,
   * которое сохраняет само (рисовалка Румика). Закрывает окно сама кнопка;
   * Esc и клик по подложке закрывают как обычно (если dismissible).
   */
  headerAction?: ReactNode;
  size?: DialogSize;
  /** false — Esc и клик по подложке не закрывают (идёт важное действие). */
  dismissible?: boolean;
  /** Что сфокусировать при открытии. По умолчанию — первый контрол в теле. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Отступы тела. false — для своей раскладки (настройки с меню слева). */
  padded?: boolean;
  className?: string;
  bodyClassName?: string;
  "data-testid"?: string;
};

/**
 * Модальное окно на нативном <dialog showModal>: остальная страница
 * неактивна (фокус не уходит за окно), Esc закрывает, фокус возвращается на
 * кнопку, которая открыла. Живёт в top layer — никаких z-index. На узком
 * экране превращается в лист снизу.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  hideTitle = false,
  children,
  footer,
  headerAction,
  size = "md",
  dismissible = true,
  initialFocus,
  padded = true,
  className,
  bodyClassName,
  "data-testid": testId,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const actionRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const downOnBackdrop = useRef(false);
  const titleId = useId();
  const descId = useId();

  const latest = useRef({ onOpenChange, dismissible });
  useLayoutEffect(() => {
    latest.current = { onOpenChange, dismissible };
  });

  // Открытие/закрытие + фокус внутрь и обратно.
  useLayoutEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      returnTo.current = document.activeElement as HTMLElement | null;
      dlg.showModal();
      const target =
        initialFocus?.current ??
        (bodyRef.current && firstFocusable(bodyRef.current)) ??
        (actionRef.current && firstFocusable(actionRef.current)) ??
        closeRef.current;
      target?.focus({ preventScroll: true });
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open, initialFocus]);

  // Закрылся (наш close или браузер сам) — вернуть фокус и сообщить наверх.
  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    const onClose = () => {
      const back = returnTo.current;
      returnTo.current = null;
      if (back?.isConnected) back.focus({ preventScroll: true });
      latest.current.onOpenChange(false);
    };
    const onCancel = (e: Event) => {
      // Esc: закрываем через состояние React, а не силами браузера.
      e.preventDefault();
      if (latest.current.dismissible) latest.current.onOpenChange(false);
    };
    dlg.addEventListener("close", onClose);
    dlg.addEventListener("cancel", onCancel);
    return () => {
      dlg.removeEventListener("close", onClose);
      dlg.removeEventListener("cancel", onCancel);
    };
  }, []);

  // Пока окно открыто, страница под ним не прокручивается.
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = prev;
    };
  }, [open]);

  // Клик по подложке: нажали и отпустили вне окна (выделение текста
  // мышью из окна наружу закрывать не должно).
  function isOutside(e: React.MouseEvent<HTMLDialogElement> | React.PointerEvent<HTMLDialogElement>): boolean {
    const dlg = ref.current;
    if (!dlg || e.target !== dlg) return false;
    const r = dlg.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      data-testid={testId}
      onPointerDown={(e) => {
        downOnBackdrop.current = isOutside(e);
      }}
      onClick={(e) => {
        if (downOnBackdrop.current && isOutside(e) && dismissible) onOpenChange(false);
        downOnBackdrop.current = false;
      }}
      className={cn(
        "m-auto max-h-[min(88dvh,880px)] w-[calc(100%-2rem)] overflow-hidden rounded-panel border-0 bg-overlay p-0 text-ink shadow-dialog",
        WIDTH[size],
        // ::backdrop наследует переменные только в свежих браузерах — запасной цвет.
        "backdrop:bg-[var(--gr-scrim,rgb(5_6_8/0.72))]",
        "opacity-100 transition-[opacity,scale,translate] duration-240 ease-swift",
        "starting:open:opacity-0 motion-safe:starting:open:scale-[0.97]",
        "backdrop:transition-opacity backdrop:duration-240 starting:open:backdrop:opacity-0",
        // Узкое окно: лист снизу во всю ширину.
        "max-sm:mb-0 max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none max-sm:max-h-[92dvh]",
        "max-sm:motion-safe:starting:open:translate-y-6 max-sm:motion-safe:starting:open:scale-100",
        className,
      )}
    >
      {/* h-full: если высоту окну задали классом (настройки), колонка равна ей и
          прокручивается тело. max-h наследуется: без заданной высоты колонка растёт
          по содержимому до того же предела, что и окно. */}
      <div className="flex h-full max-h-[inherit] flex-col">
        <header className={cn("flex items-start gap-3 px-6 pb-2 pt-5 max-sm:px-5", hideTitle && "pb-0 pt-3")}>
          <div className={cn("min-w-0 flex-1", hideTitle && "sr-only")}>
            <h2 id={titleId} className="text-title text-ink">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1 text-body text-ink-2">
                {description}
              </p>
            )}
          </div>
          {headerAction ? (
            // -my-1: кнопка sm (32) встаёт по середине строки заголовка (24), как крестик.
            <div ref={actionRef} className={cn("-my-1 flex shrink-0 items-center gap-2", hideTitle && "ml-auto")}>
              {headerAction}
            </div>
          ) : (
            dismissible && (
              <IconButton
                ref={closeRef}
                icon="x"
                label="Закрыть"
                shortcut="Esc"
                size="sm"
                className={cn("-mr-2 -mt-1", hideTitle && "ml-auto")}
                onClick={() => onOpenChange(false)}
              />
            )
          )}
        </header>
        <div
          ref={bodyRef}
          className={cn("min-h-0 flex-1 overflow-y-auto", padded && "px-6 pb-6 pt-3 max-sm:px-5", bodyClassName)}
        >
          {children}
        </div>
        {footer && (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-6 py-4 max-sm:px-5">
            {footer}
          </footer>
        )}
      </div>
    </dialog>
  );
}

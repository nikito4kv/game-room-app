"use client";

import {
  useMemo,
  useRef,
  type ButtonHTMLAttributes,
  type FocusEvent,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { cn } from "./cn";
import type { Align, Side } from "./floating";
import { Icon, type IconName } from "./icons";
import { mergeRefs } from "./refs";
import { Spinner } from "./Spinner";
import {
  FLOATING_RESET,
  isRef,
  useDismiss,
  useFocusOnOpen,
  usePlaceFloating,
  useTopLayer,
  type FloatingAnchor,
} from "./useFloating";

export type PopoverProps = Omit<HTMLAttributes<HTMLDivElement>, "role"> & {
  ref?: Ref<HTMLDivElement>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * К чему привязан: ref на кнопку-триггер или точка ({x, y, width: 0,
   * height: 0}) — например, место клика по плитке участника.
   */
  anchor: FloatingAnchor;
  side?: Side;
  align?: Align;
  offset?: number;
  /** Роль контейнера. dialog — смешанное содержимое, menu — только действия. */
  role?: "dialog" | "menu";
  /** Куда поставить фокус при открытии. */
  focus?: "first" | "container" | "none";
  /** Ref на ваш триггер — клик по нему не считается «кликом мимо». */
  triggerRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
};

/**
 * Всплывающая панель у якоря: меню участника, «Пригласить», громкость
 * показа. Живёт в top layer (поверх диалогов), закрывается кликом мимо и
 * Esc, возвращает фокус туда, откуда открыли. Немодальная: Tab может уйти
 * наружу — тогда панель (role="dialog") закрывается сама, чтобы не висела
 * открытой без фокуса. Для списка действий — Menu (там же стрелки).
 */
export function Popover({
  ref: externalRef,
  open,
  onOpenChange,
  anchor,
  side = "bottom",
  align = "start",
  offset = 8,
  role = "dialog",
  focus = "first",
  triggerRef,
  className,
  children,
  onBlur,
  ...props
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const setRef = useMemo(() => mergeRefs(ref, externalRef), [externalRef]);
  // Порядок важен: сначала показать в top layer, потом ставить и фокусировать.
  useTopLayer(open, ref);
  usePlaceFloating(open, ref, anchor, { side, align, offset });
  const focusBack = useFocusOnOpen(open, ref, focus);
  // Клик по самому якорю/триггеру — не «мимо»: его onClick сам переключит open.
  useDismiss(open, () => onOpenChange(false), ref, anchor, triggerRef);

  function onFocusOut(e: FocusEvent<HTMLDivElement>) {
    onBlur?.(e);
    // У меню свой Tab (закрыть и вернуть фокус) — см. Menu. Фокус уводит сам
    // useFocusOnOpen (закрытие, двойной запуск эффектов в деве) — это не уход.
    if (role !== "dialog" || !open || focusBack.returning.current) return;
    const next = e.relatedTarget;
    // Ушли в адресную строку или другое окно (relatedTarget нет) — не закрываем:
    // человек вернётся туда же. Фокус перешёл внутрь — тоже.
    if (!(next instanceof Node) || ref.current?.contains(next)) return;
    // На якорь или триггер — его клик сам переключит open (иначе закрыли бы и
    // тут же открыли снова).
    if ((isRef(anchor) && anchor.current?.contains(next)) || triggerRef?.current?.contains(next)) return;
    // Tab увёл фокус наружу: закрываем и фокус не тянем назад — человек сам выбрал, куда идти.
    focusBack.release();
    onOpenChange(false);
  }

  return (
    <div
      ref={setRef}
      popover="manual"
      role={role}
      tabIndex={-1}
      className={cn(
        FLOATING_RESET,
        "min-w-48 max-w-[calc(100vw-16px)] rounded-card bg-overlay p-1.5 text-body text-ink shadow-float",
        "opacity-100 transition-[opacity,scale] duration-180 ease-swift focus-visible:outline-0",
        "starting:open:opacity-0 motion-safe:starting:open:scale-[0.96]",
        className,
      )}
      onBlur={onFocusOut}
      {...props}
    >
      {children}
    </div>
  );
}

export type PopoverItemProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  icon?: IconName;
  tone?: "default" | "danger";
  /** Действие выполняется: крутилка вместо иконки и aria-busy. Блокировку задаёт disabled. */
  busy?: boolean;
};

/**
 * Пункт действия в Popover role="dialog" — панели со смешанным содержимым
 * (ползунок, переключатель и действия, как в панели участника). Это обычная
 * кнопка в порядке Tab: в отличие от MenuItem, который живёт только внутри Menu
 * и ходит стрелками. Вид — как у MenuItem.
 */
export function PopoverItem({
  icon,
  tone = "default",
  busy = false,
  className,
  children,
  ...props
}: PopoverItemProps) {
  const danger = tone === "danger";
  return (
    <button
      type="button"
      aria-busy={busy || undefined}
      className={cn(
        "flex h-9 w-full min-w-0 items-center gap-2.5 rounded-item px-2.5 text-left text-body",
        "transition-colors duration-140 focus-visible:outline-offset-[-2px] disabled:pointer-events-none disabled:opacity-45",
        danger ? "text-alert-ink hover:bg-alert-wash" : "text-ink hover:bg-wash-2",
        className,
      )}
      {...props}
    >
      {busy ? (
        <Spinner size={18} />
      ) : (
        icon && <Icon name={icon} size={18} className={danger ? undefined : "text-ink-2"} />
      )}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

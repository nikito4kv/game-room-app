"use client";

import {
  cloneElement,
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { Button } from "./Button";
import { cn } from "./cn";
import type { Align, Side } from "./floating";
import { Icon, type IconName } from "./icons";
import { Kbd } from "./Kbd";
import { Popover } from "./Popover";
import { nextIndex, rovingKey } from "./roving";

const MenuCtx = createContext<{ close: () => void } | null>(null);

type TriggerProps = {
  onClick?: (e: MouseEvent<HTMLElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
};

const ITEM_SELECTOR = '[role^="menuitem"]:not([disabled])';

/**
 * Меню действий у кнопки: «Комната ▾», «⋯». Триггер — ваш Button или
 * IconButton (получит aria-haspopup/expanded и onClick). Свой ref на триггер
 * не нужен: якорь меню Menu находит сам. Клавиатура: ↓/↑ открывают и ходят
 * по пунктам, Home/End, Enter — выбрать, Esc/Tab — закрыть.
 */
export function Menu({
  trigger,
  children,
  label,
  side = "bottom",
  align = "start",
  open: controlledOpen,
  onOpenChange,
  className,
}: {
  trigger: ReactElement<TriggerProps>;
  children: ReactNode;
  /** Подпись меню для скринридера. */
  label: string;
  side?: Side;
  align?: Align;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlledOpen ?? innerOpen;
  const wrapRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Открыли стрелкой вверх — фокус на последний пункт (состояние, а не ref:
  // меняется в обработчике триггера).
  const [edge, setEdge] = useState<"first" | "last">("first");
  const id = useId();

  const setOpen = (v: boolean) => {
    onOpenChange?.(v);
    if (controlledOpen === undefined) setInnerOpen(v);
  };

  // Триггер оборачиваем в span с display: contents — он не меняет раскладку,
  // а якорем меню служит сам элемент триггера (первый ребёнок обёртки).
  useLayoutEffect(() => {
    triggerRef.current = (wrapRef.current?.firstElementChild as HTMLElement | null) ?? null;
  });

  useEffect(() => {
    if (!open || edge !== "last") return;
    const items = menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR);
    items?.[items.length - 1]?.focus();
  }, [open, edge]);

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Tab") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    const move = rovingKey(e.key, "vertical");
    if (!move) return;
    e.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = nextIndex(
      current < 0 ? (move === "prev" ? 0 : items.length - 1) : current,
      move,
      items.map((el) => (el as HTMLButtonElement).disabled === true),
    );
    items[next]?.focus();
  }

  const triggerEl = cloneElement(trigger, {
    "aria-haspopup": "menu",
    "aria-expanded": open,
    "aria-controls": open ? id : undefined,
    onClick: (e: MouseEvent<HTMLElement>) => {
      trigger.props.onClick?.(e);
      setEdge("first");
      setOpen(!open);
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      trigger.props.onKeyDown?.(e);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setEdge(e.key === "ArrowUp" ? "last" : "first");
        setOpen(true);
      }
    },
  } as Partial<TriggerProps> & Record<string, unknown>);

  return (
    <>
      <span ref={wrapRef} className="contents">
        {triggerEl}
      </span>
      <MenuCtx.Provider value={{ close: () => setOpen(false) }}>
        <Popover
          ref={menuRef}
          id={id}
          open={open}
          onOpenChange={setOpen}
          anchor={triggerRef}
          triggerRef={wrapRef}
          side={side}
          align={align}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className={cn("w-64", className)}
        >
          {children}
        </Popover>
      </MenuCtx.Provider>
    </>
  );
}

export type MenuItemProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "role"> & {
  icon?: IconName;
  tone?: "default" | "danger";
  /** Клавиша справа (Kbd). */
  shortcut?: string;
  /** Тихий текст справа: «42 мс», «вкл». */
  hint?: ReactNode;
  /** Выбор пункта. Меню закрывается само, если не keepOpen. */
  onSelect?: () => void;
  keepOpen?: boolean;
  /** Для пунктов-флажков (menuitemcheckbox): галочка справа. */
  checked?: boolean;
};

export function MenuItem({
  icon,
  tone = "default",
  shortcut,
  hint,
  onSelect,
  keepOpen = false,
  checked,
  className,
  children,
  onClick,
  ...props
}: MenuItemProps) {
  const ctx = useContext(MenuCtx);
  const danger = tone === "danger";
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={checked}
      tabIndex={-1}
      onClick={(e) => {
        onClick?.(e);
        onSelect?.();
        if (!keepOpen) ctx?.close();
      }}
      className={cn(
        "flex h-9 w-full min-w-0 items-center gap-2.5 rounded-item px-2.5 text-left text-body",
        "transition-colors duration-140 focus-visible:outline-0 disabled:opacity-40",
        danger
          ? "text-alert-ink hover:bg-alert-wash focus-visible:bg-alert-wash"
          : "text-ink hover:bg-wash-2 focus-visible:bg-wash-3",
        className,
      )}
      {...props}
    >
      {icon && <Icon name={icon} size={18} className={danger ? "" : "text-ink-2"} />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="shrink-0 text-label tabular-nums text-ink-3">{hint}</span>}
      {shortcut && <Kbd size="sm">{shortcut}</Kbd>}
      {checked !== undefined && (
        <Icon name="check" size={16} className={cn("shrink-0", checked ? "text-ink" : "invisible")} />
      )}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="-mx-1.5 my-1.5 h-px bg-line" />;
}

/** Подзаголовок группы пунктов («Хост»). */
export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div role="presentation" className="px-2.5 pb-1 pt-2 text-caption font-medium text-ink-3">
      {children}
    </div>
  );
}

/**
 * Подтверждение действия прямо в меню или поповере (вместо второго окна):
 * «Выгнать Петю?» + Отмена/Выгнать. Фокус — на «Отмена», чтобы случайный Enter
 * ничего не сломал. tone="danger" (по умолчанию) — красная кнопка для
 * необратимого; "neutral" — обычная, когда действие можно отменить потом
 * (например, «Сделать хостом» у владельца).
 */
export function MenuConfirm({
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
  busy = false,
  tone = "danger",
}: {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  tone?: "danger" | "neutral";
}) {
  const titleId = useId();
  return (
    <div role="group" aria-labelledby={titleId} className="flex w-72 max-w-full flex-col gap-3 p-2">
      <div>
        <p id={titleId} className="text-body font-semibold text-ink">
          {title}
        </p>
        {description && <p className="mt-1 text-label text-ink-2">{description}</p>}
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} autoFocus>
          Отмена
        </Button>
        <Button size="sm" variant={tone === "danger" ? "danger" : "secondary"} onClick={onConfirm} loading={busy}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}

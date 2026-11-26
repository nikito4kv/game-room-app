"use client";

import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "./cn";
import { Icon, type IconName } from "./icons";
import { nextIndex, rovingKey } from "./roving";

type Orientation = "horizontal" | "vertical";

type TabsCtx = {
  value: string;
  setValue: (v: string) => void;
  baseId: string;
  orientation: Orientation;
};

const Ctx = createContext<TabsCtx | null>(null);

function useTabs(): TabsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("Tab/TabList/TabPanel должны быть внутри <Tabs>");
  return ctx;
}

const tabId = (base: string, v: string) => `${base}-tab-${v}`;
const panelId = (base: string, v: string) => `${base}-panel-${v}`;

/**
 * Вкладки. Горизонтальные — с подчёркиванием, которое переезжает к выбранной
 * (transform, только при смене). Вертикальные — меню разделов слева
 * (настройки на широком экране). Активация сразу по стрелкам.
 *
 *   <Tabs value={tab} onValueChange={setTab} label="Разделы настроек">
 *     <TabList><Tab value="voice" icon="mic">Голос</Tab>…</TabList>
 *     <TabPanel value="voice">…</TabPanel>
 *   </Tabs>
 */
export function Tabs({
  value,
  onValueChange,
  orientation = "horizontal",
  className,
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
  orientation?: Orientation;
  className?: string;
  children: ReactNode;
}) {
  const baseId = useId();
  return (
    <Ctx.Provider value={{ value, setValue: onValueChange, baseId, orientation }}>
      <div className={className}>{children}</div>
    </Ctx.Provider>
  );
}

export function TabList({
  label,
  className,
  children,
}: {
  /** Подпись списка вкладок для скринридера. */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const { value, setValue, orientation } = useTabs();
  const listRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const placedRef = useRef(false);
  const horizontal = orientation === "horizontal";

  // Подчёркивание: меряем выбранную вкладку и переносим полоску transform'ом.
  // Первую расстановку делаем без анимации — полоска не «выезжает» при открытии.
  useLayoutEffect(() => {
    if (!horizontal) return;
    const list = listRef.current;
    const bar = barRef.current;
    const active = list?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!list || !bar || !active) return;
    const first = !placedRef.current;
    if (first) bar.style.transition = "none";
    bar.style.transform = `translateX(${active.offsetLeft}px) scaleX(${active.offsetWidth})`;
    if (first) {
      void bar.offsetWidth; // зафиксировать стартовое положение до возврата transition
      bar.style.transition = "";
      placedRef.current = true;
    }
  }, [value, horizontal]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    // Вертикальный список на узком экране становится строкой — слушаем обе оси.
    const move = rovingKey(e.key, horizontal ? "horizontal" : "both");
    if (!move) return;
    const tabs = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
    const current = tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
    const next = nextIndex(
      Math.max(0, current),
      move,
      tabs.map((t) => t.disabled),
    );
    const v = tabs[next]?.dataset.value;
    if (!v) return;
    e.preventDefault();
    setValue(v);
    tabs[next].focus();
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      aria-orientation={orientation}
      onKeyDown={onKeyDown}
      className={cn(
        "relative flex",
        horizontal
          ? "gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]"
          : "flex-col gap-0.5",
        className,
      )}
    >
      {children}
      {horizontal && (
        <span
          ref={barRef}
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 left-0 h-0.5 w-px origin-left rounded-full bg-ink transition-transform duration-240 ease-swift"
        />
      )}
    </div>
  );
}

export function Tab({
  value,
  icon,
  disabled,
  className,
  children,
}: {
  value: string;
  icon?: IconName;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ctx = useTabs();
  const selected = ctx.value === value;
  const horizontal = ctx.orientation === "horizontal";
  return (
    <button
      type="button"
      role="tab"
      id={tabId(ctx.baseId, value)}
      aria-selected={selected}
      aria-controls={panelId(ctx.baseId, value)}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      data-value={value}
      onClick={() => ctx.setValue(value)}
      className={cn(
        "inline-flex shrink-0 items-center gap-2 whitespace-nowrap font-medium transition-colors duration-140 disabled:opacity-40",
        horizontal
          ? cn(
              "h-10 rounded-t-item px-3 text-body focus-visible:outline-offset-[-2px]",
              selected ? "text-ink" : "text-ink-3 hover:text-ink-2",
            )
          : cn(
              "h-10 w-full rounded-item px-3 text-left text-body",
              selected ? "bg-wash-3 text-ink" : "text-ink-2 hover:bg-wash-1 hover:text-ink",
            ),
        className,
      )}
    >
      {icon && <Icon name={icon} size={18} className={selected ? "text-ink" : "text-ink-3"} />}
      {children}
    </button>
  );
}

export function TabPanel({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: ReactNode;
}) {
  const ctx = useTabs();
  if (ctx.value !== value) return null;
  return (
    <div
      role="tabpanel"
      id={panelId(ctx.baseId, value)}
      aria-labelledby={tabId(ctx.baseId, value)}
      tabIndex={0}
      className={cn("focus-visible:outline-offset-4", className)}
    >
      {children}
    </div>
  );
}

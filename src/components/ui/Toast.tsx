"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Avatar, RumikAvatar } from "./Avatar";
import { Button } from "./Button";
import { cn } from "./cn";
import { Icon, type IconName } from "./icons";
import {
  markLeaving,
  promoteToast,
  removeToast,
  TOAST_DURATION,
  upsertToast,
  visibleToasts,
  type ToastTone,
} from "./toastQueue";

export type { ToastTone };

/**
 * Человек в тосте. По умолчанию — голова Румика его цвета (или белая под его
 * рисунком), как его место за столом; `variant: "initials"` — кружок с
 * инициалами, где Румиков выключили (флаг rumik_table). `head` — своя голова
 * 32 px вместо готовой: в комнате — живая, рисунок встаёт, как только придёт
 * (через миг после входа человека).
 */
export type ToastPerson = {
  name: string;
  colorIndex?: number;
  paint?: string | null;
  variant?: "rumik" | "initials";
  head?: ReactNode;
};

export type ToastInput = {
  /** Тот же id обновляет тост на месте («Переподключаемся…» → «Снова на связи»). */
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** Иконка слева. Для событий участника лучше `person`. */
  icon?: IconName;
  /** Человек слева: вход, выход, сообщение в чат. */
  person?: ToastPerson;
  action?: { label: string; onClick: () => void };
  /** Мс до скрытия. Infinity — пока не закроют. По умолчанию от тона. */
  duration?: number;
  /**
   * Ответ на нажатие («почему кнопка неактивна»): показать сразу, а не ждать в
   * очереди за старыми. Если видимые места заняты, самый старый тост уходит.
   */
  immediate?: boolean;
};

type ToastRecord = Omit<ToastInput, "id" | "tone" | "duration" | "immediate"> & {
  id: string;
  tone: ToastTone;
  duration: number;
  leaving?: boolean;
  /** Номер показа: повторный toast() с тем же id заново заводит таймер. */
  version: number;
};

const EXIT_MS = 160;
const TONE_ICON: Record<ToastTone, { name: IconName; cls: string }> = {
  neutral: { name: "info", cls: "text-ink-2" },
  signal: { name: "check-circle", cls: "text-signal-ink" },
  caution: { name: "alert-triangle", cls: "text-caution-ink" },
  alert: { name: "alert-circle", cls: "text-alert-ink" },
};

// Простое внешнее хранилище: toast() можно звать откуда угодно, без контекста.
let records: ToastRecord[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const snapshot = () => records;
const EMPTY: ToastRecord[] = [];
const serverSnapshot = () => EMPTY;

function dismiss(id?: string) {
  const ids = id ? [id] : records.map((r) => r.id);
  for (const one of ids) {
    records = markLeaving(records, one);
    window.setTimeout(() => {
      // Тот же id успели показать снова (новое сообщение в чат) — его не трогаем.
      if (!records.find((r) => r.id === one)?.leaving) return;
      records = removeToast(records, one);
      emit();
    }, EXIT_MS);
  }
  emit();
}

/**
 * Показать тост. Возвращает id — им можно обновить или закрыть тост.
 *
 *   toast({ title: "Петя", description: "теперь в комнате", person: { name: "Петя", colorIndex: 3 } });
 *   toast({ tone: "alert", title: "Не удалось выгнать", description: "Участник уже вышел" });
 */
export function toast(input: ToastInput): string {
  const { immediate = false, ...rest } = input;
  const tone = rest.tone ?? "neutral";
  const id = rest.id ?? `toast-${++seq}`;
  records = upsertToast(records, {
    ...rest,
    id,
    tone,
    duration: rest.duration ?? TOAST_DURATION[tone],
    leaving: false,
    version: ++seq,
  });
  if (immediate) {
    const promoted = promoteToast(records, id);
    records = promoted.list;
    if (promoted.evict) dismiss(promoted.evict);
  }
  emit();
  return id;
}
toast.dismiss = dismiss;

/**
 * Место для тостов. Одно на экран, внутри UiRoot. placement:
 *   top-left — комната: под шапкой слева, там не мешает столу и доку
 *              (отступ сверху — переменная --gr-toast-top у корня экрана);
 *   bottom-left — остальные экраны.
 * На узком экране — всегда сверху во всю ширину (отступ — тот же
 * --gr-toast-top). Видно до трёх, остальные ждут. Таймеры стоят, пока мышь
 * двигается над тостами (читают) или вкладка скрыта.
 */
export function Toaster({
  placement = "bottom-left",
  className,
}: {
  placement?: "top-left" | "bottom-left";
  className?: string;
}) {
  const list = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [hovered, setHovered] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const onVis = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const shown = visibleToasts(list);

  // Пауза — только от движения мыши над стопкой, а не от «курсор оказался
  // сверху»: новый тост, выехавший под неподвижный курсор, иначе стоял бы, пока
  // мышь не сдвинут. Тост убрали (кнопка в тосте, крестик) — паузу снимаем до
  // следующего движения: pointerleave при неподвижной мыши не придёт, и пауза
  // повисла бы у всей стопки.
  const [prevCount, setPrevCount] = useState(shown.length);
  if (shown.length !== prevCount) {
    setPrevCount(shown.length);
    if (shown.length < prevCount && hovered) setHovered(false);
  }

  return (
    <section
      aria-label="Уведомления"
      data-placement={placement}
      className={cn(
        "group/toaster pointer-events-none fixed left-4 z-[var(--gr-z-toast)] w-[360px] max-w-[calc(100vw-24px)]",
        placement === "top-left" ? "top-[var(--gr-toast-top,16px)]" : "bottom-4",
        "max-sm:inset-x-3 max-sm:bottom-auto max-sm:top-[var(--gr-toast-top,12px)] max-sm:w-auto",
        className,
      )}
      onPointerMove={() => {
        if (!hovered) setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
    >
      {/* Новый тост — ближе к краю, у которого стоит стопка. */}
      <ol
        aria-live="polite"
        aria-relevant="additions"
        className={cn("flex gap-2", placement === "top-left" ? "flex-col-reverse" : "flex-col max-sm:flex-col-reverse")}
      >
        {shown.map((t) => (
          <ToastView key={t.id} t={t} paused={hovered || hidden} />
        ))}
      </ol>
    </section>
  );
}

function ToastView({ t, paused }: { t: ToastRecord; paused: boolean }) {
  const remaining = useRef(t.duration);
  const startedAt = useRef(0);

  // Тост показали снова (тот же id: новое сообщение, повторное нажатие) — отсчёт сначала.
  useEffect(() => {
    remaining.current = t.duration;
  }, [t.duration, t.version]);

  useEffect(() => {
    if (paused || t.leaving || !Number.isFinite(remaining.current)) return;
    startedAt.current = performance.now();
    const timer = window.setTimeout(() => dismiss(t.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current -= performance.now() - startedAt.current;
    };
  }, [paused, t.leaving, t.id, t.duration, t.version]);

  const icon = t.icon ? { name: t.icon, cls: TONE_ICON[t.tone].cls } : TONE_ICON[t.tone];

  return (
    <li
      role={t.tone === "alert" ? "alert" : undefined}
      data-leaving={t.leaving || undefined}
      className={cn(
        "group pointer-events-auto flex items-start gap-3 rounded-card bg-overlay py-2.5 pl-3 pr-2 shadow-float",
        "transition-[opacity,translate] duration-240 ease-swift",
        // Въезжает от края стопки: снизу — вверх, сверху — вниз. Уходит влево.
        "starting:opacity-0 motion-safe:starting:translate-y-2",
        "group-data-[placement=top-left]/toaster:motion-safe:starting:-translate-y-2 max-sm:motion-safe:starting:-translate-y-2",
        "data-leaving:opacity-0 data-leaving:duration-160 motion-safe:data-leaving:-translate-x-2",
      )}
    >
      {t.person ? (
        <ToastHead person={t.person} />
      ) : (
        <span className="grid size-8 shrink-0 place-items-center">
          <Icon name={icon.name} size={20} className={icon.cls} />
        </span>
      )}
      <div className="min-w-0 flex-1 py-1">
        <p className="text-pretty text-body font-medium text-ink">{t.title}</p>
        {t.description && <p className="mt-0.5 text-pretty text-label text-ink-2">{t.description}</p>}
      </div>
      {t.action && (
        <Button
          size="sm"
          variant="secondary"
          className="mt-0.5 self-start"
          onClick={() => {
            t.action?.onClick();
            dismiss(t.id);
          }}
        >
          {t.action.label}
        </Button>
      )}
      <button
        type="button"
        onClick={() => dismiss(t.id)}
        aria-label="Закрыть уведомление"
        className={cn(
          "mt-0.5 grid size-7 shrink-0 place-items-center rounded-item text-ink-3 transition-[opacity,background-color,color] duration-140",
          "hover:bg-wash-2 hover:text-ink pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-visible:opacity-100",
        )}
      >
        <Icon name="x" size={16} />
      </button>
    </li>
  );
}

/** Голова человека слева в тосте: 32 px на поверхности overlay. */
function ToastHead({ person }: { person: ToastPerson }) {
  if (person.head) return <span className="grid size-8 shrink-0 place-items-center">{person.head}</span>;
  return person.variant === "initials" ? (
    <Avatar name={person.name} colorIndex={person.colorIndex} size="sm" surface="overlay" />
  ) : (
    <RumikAvatar name={person.name} colorIndex={person.colorIndex} paint={person.paint} size="sm" surface="overlay" />
  );
}

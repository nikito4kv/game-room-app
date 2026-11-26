"use client";

import type { ButtonHTMLAttributes, MouseEvent, ReactElement, ReactNode, Ref } from "react";
import { cn } from "./cn";
import type { Side } from "./floating";
import { Icon, type IconName } from "./icons";
import { Kbd } from "./Kbd";
import { Spinner } from "./Spinner";
import { toast } from "./Toast";
import { Tooltip } from "./Tooltip";

export type IconButtonVariant =
  | "ghost"
  | "quiet"
  | "soft"
  | "inverse"
  | "danger"
  | "signal"
  | "danger-ghost"
  | "scrim"
  | "scrim-ghost";
/** split — узкая половина «сплит-кнопки» 24×48: шеврон выбора устройства у кнопки дока lg. */
export type IconButtonSize = "sm" | "md" | "lg" | "xl" | "split";

// Вид и отклик на наведение — отдельно: у неактивной кнопки с причиной
// (disabledReason) наведение не должно её «оживлять».
const VARIANT: Record<IconButtonVariant, { base: string; hover: string }> = {
  ghost: { base: "text-ink-2", hover: "hover:bg-wash-2 hover:text-ink" },
  // Второстепенное рядом с главной кнопкой (шеврон в доке): тише ghost.
  quiet: { base: "text-ink-3", hover: "hover:bg-wash-2 hover:text-ink" },
  soft: { base: "bg-wash-2 text-ink", hover: "hover:bg-wash-3" },
  // «Включено, и это нормально»: идёт показ экрана, открыт чат.
  inverse: { base: "bg-ink text-inverse", hover: "hover:bg-ink/88" },
  // «Вас не слышно / вы не слышите»: микрофон выкл, звук выкл.
  danger: { base: "bg-alert text-on-alert", hover: "hover:bg-alert/88" },
  // «Передаёт»: микрофон в эфире в режиме рации, своя речь.
  signal: { base: "bg-signal text-on-signal", hover: "hover:bg-signal/88" },
  "danger-ghost": { base: "text-alert-ink", hover: "hover:bg-alert-wash" },
  // Поверх видео: картинка бывает любой яркости, поэтому цвета фиксированные,
  // не из темы. Полупрозрачный чёрный без blur — дёшево для видеокарты.
  scrim: { base: "bg-[rgb(0_0_0/0.55)] text-white", hover: "hover:bg-[rgb(0_0_0/0.72)]" },
  // Внутри scrim-плашки (громкость показа): подложку уже даёт плашка.
  "scrim-ghost": { base: "text-white", hover: "hover:bg-[rgb(255_255_255/0.15)]" },
};

/** Один тост на все «почему не нажимается»: повторные нажатия обновляют его на месте. */
const DISABLED_REASON_TOAST = "disabled-reason";

const SIZE: Record<IconButtonSize, { box: string; icon: number }> = {
  sm: { box: "size-8", icon: 16 },
  md: { box: "size-10", icon: 18 },
  lg: { box: "size-12", icon: 20 },
  xl: { box: "size-14", icon: 22 },
  split: { box: "h-12 w-6", icon: 16 },
};

// aria-keyshortcuts понимает только реальные имена клавиш.
function ariaShortcut(s: string | undefined): string | undefined {
  return s && /^([A-Z0-9]|Space|Enter|Tab|F\d{1,2})$/.test(s) ? s : undefined;
}

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  ref?: Ref<HTMLButtonElement>;
  icon: IconName | ReactElement;
  /** Что это за кнопка. Это aria-label и (если нет hint) текст подсказки. */
  label: string;
  /**
   * Текст подсказки, если он отличается от label. Для переключателей: label
   * постоянный («Микрофон») + pressed, а hint — действие («Выключить микрофон»).
   */
  hint?: string;
  /** Клавиша для подсказки: «M». Берите из formatKeyCode(binds.mic). */
  shortcut?: string;
  /**
   * Показать букву клавиши прямо на кнопке (настройка «Подсказки клавиш»).
   * На сенсорных экранах (pointer: coarse) буква не рисуется: клавиатуры нет.
   */
  showShortcut?: boolean;
  /**
   * Почему кнопка неактивна — только вместе с disabled. Тогда вместо атрибута
   * disabled ставится aria-disabled: кнопка выглядит неактивной и onClick не
   * зовёт, но нажатие (мышь, палец, Enter) показывает тост с причиной, а
   * подсказка по умолчанию — саму причину. На телефоне подсказок нет, и без
   * этого человек не узнал бы, почему кнопка «не работает».
   */
  disabledReason?: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  shape?: "square" | "round";
  /** Для переключателей (микрофон, звук, экран): aria-pressed. */
  pressed?: boolean;
  /** Своя подсказка или false — без неё. По умолчанию: label + Kbd. */
  tooltip?: ReactNode | false;
  tooltipSide?: Side;
  /** Значок поверх угла: <CountBadge count={3} />. */
  badge?: ReactNode;
  loading?: boolean;
  /** Класс обёртки подсказки (если кнопка должна тянуться во flex). */
  wrapperClassName?: string;
};

/**
 * Кнопка-иконка с подсказкой и клавишей. Основа дока, шапки и кнопок поверх
 * видео. Подпись обязательна: без неё кнопку не поймёт скринридер.
 */
export function IconButton({
  ref,
  icon,
  label,
  hint,
  shortcut,
  showShortcut = false,
  variant = "ghost",
  size = "md",
  shape = "square",
  pressed,
  tooltip,
  tooltipSide = "top",
  badge,
  loading = false,
  wrapperClassName,
  className,
  type = "button",
  disabled,
  disabledReason,
  onClick,
  ...props
}: IconButtonProps) {
  const s = SIZE[size];
  // «Мягко» неактивна: видна и нажимается, но вместо действия объясняет причину.
  const explained = !!disabled && !!disabledReason;
  const explain = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    toast({ id: DISABLED_REASON_TOAST, title: disabledReason, icon: "info", immediate: true });
  };
  const button = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-keyshortcuts={ariaShortcut(shortcut)}
      aria-pressed={pressed}
      aria-busy={loading || undefined}
      aria-disabled={explained || undefined}
      disabled={disabled && !explained}
      onClick={explained ? explain : onClick}
      className={cn(
        "relative inline-grid shrink-0 select-none place-items-center",
        "transition-[background-color,color,scale] duration-140 ease-swift",
        "active:scale-[0.94] motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-40",
        "aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:active:scale-100",
        s.box,
        shape === "round" || size === "split" ? "rounded-full" : size === "sm" ? "rounded-item" : "rounded-control",
        VARIANT[variant].base,
        !explained && VARIANT[variant].hover,
        className,
      )}
      {...props}
    >
      {loading ? (
        <Spinner size={s.icon} />
      ) : typeof icon === "string" ? (
        <Icon name={icon} size={s.icon} />
      ) : (
        icon
      )}
      {showShortcut && shortcut && (
        // Маленькая клавиша в углу: своя подложка, поэтому читается на любой
        // заливке кнопки (красной, лаймовой, светлой). Не меньше 11 px — правило ДС.
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute -bottom-1 -right-1 grid h-[18px] min-w-[18px] place-items-center rounded-key px-1",
            "border border-line-strong bg-overlay text-micro font-semibold text-ink-2 pointer-coarse:hidden",
          )}
        >
          {shortcut}
        </span>
      )}
      {badge && <span className="pointer-events-none absolute -right-1 -top-1">{badge}</span>}
    </button>
  );

  if (tooltip === false) return button;
  return (
    <Tooltip
      side={tooltipSide}
      className={wrapperClassName}
      content={
        tooltip ??
        (explained ? (
          disabledReason
        ) : (
          <span className="flex items-center gap-2">
            {hint ?? label}
            {shortcut && <Kbd size="sm">{shortcut}</Kbd>}
          </span>
        ))
      }
    >
      {button}
    </Tooltip>
  );
}

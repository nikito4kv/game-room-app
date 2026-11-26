import type { ButtonHTMLAttributes, Ref } from "react";
import { cn } from "./cn";
import { Icon, type IconName } from "./icons";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-control font-medium " +
  "transition-[background-color,color,box-shadow,scale] duration-140 ease-swift " +
  "active:scale-[0.97] motion-reduce:active:scale-100 " +
  "disabled:pointer-events-none disabled:opacity-45 aria-busy:pointer-events-none";

const VARIANT: Record<ButtonVariant, string> = {
  // Главная кнопка — «чернильная»: светлая заливка в тёмной теме, тёмная в светлой.
  primary: "bg-ink text-inverse hover:bg-ink/88",
  secondary: "bg-wash-2 text-ink border border-line-strong hover:bg-wash-3 hover:border-line-control",
  ghost: "text-ink-2 hover:bg-wash-2 hover:text-ink",
  danger: "bg-alert text-on-alert hover:bg-alert/88",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-label",
  md: "h-10 px-4 text-body",
  lg: "h-12 px-5 text-body-lg",
};

const ICON_SIZE: Record<ButtonSize, number> = { sm: 16, md: 18, lg: 20 };

/** Классы кнопки — для <a> и next/link, которые должны выглядеть как кнопка. */
export function buttonClass({
  variant = "secondary",
  size = "md",
  block = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  className?: string;
} = {}): string {
  return cn(BASE, VARIANT[variant], SIZE[size], block && "w-full", className);
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  ref?: Ref<HTMLButtonElement>;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Иконка слева от текста. */
  icon?: IconName;
  /** Иконка справа (например, chevron-down у кнопки-меню). */
  iconRight?: IconName;
  /** Идёт действие: крутилка вместо содержимого, ширина и цвет не меняются, клики не проходят. */
  loading?: boolean;
  /** Во всю ширину контейнера. */
  block?: boolean;
};

/**
 * Кнопка с текстом. Варианты по смыслу:
 * primary — одно главное действие на экране («Пригласить», «Войти»);
 * secondary — обычные действия; ghost — тихие (в шапках, «Отмена»);
 * danger — необратимое («Выгнать», «Забанить»).
 */
export function Button({
  ref,
  variant = "secondary",
  size = "md",
  icon,
  iconRight,
  loading = false,
  block = false,
  className,
  children,
  type = "button",
  disabled,
  ...props
}: ButtonProps) {
  const iconSize = ICON_SIZE[size];
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      aria-busy={loading || undefined}
      className={buttonClass({ variant, size, block, className })}
      {...props}
    >
      <span className={cn("inline-flex items-center gap-2", loading && "invisible")}>
        {icon && <Icon name={icon} size={iconSize} className="-ml-0.5" />}
        {children}
        {iconRight && <Icon name={iconRight} size={iconSize} className="-mr-1 opacity-70" />}
      </span>
      {loading && (
        <span className="absolute inset-0 grid place-items-center">
          <Spinner size={iconSize} />
        </span>
      )}
    </button>
  );
}

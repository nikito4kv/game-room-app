import type { ButtonHTMLAttributes, Ref } from "react";
import { cn } from "./cn";

export type SwitchProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "role"> & {
  ref?: Ref<HTMLButtonElement>;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  size?: "sm" | "md";
};

/**
 * Переключатель (role="switch"). Включён — «чернильная» дорожка (светлая в
 * тёмной теме), не зелёная: зелёный signal зарезервирован за «передаёт».
 * Подпись — через <label htmlFor> рядом (SettingRow) или aria-label.
 */
export function Switch({
  ref,
  checked,
  onCheckedChange,
  size = "md",
  className,
  disabled,
  ...props
}: SwitchProps) {
  const md = size === "md";
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full border",
        "transition-[background-color,border-color] duration-180 ease-swift",
        "disabled:cursor-not-allowed disabled:opacity-45",
        md ? "h-[22px] w-[38px]" : "h-[18px] w-[32px]",
        checked ? "border-ink bg-ink" : "border-line-strong bg-wash-3 hover:border-line-control",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "block rounded-full shadow-[0_1px_2px_rgb(0_0_0/0.35)] transition-transform duration-180 ease-swift",
          md ? "size-4" : "size-3",
          checked
            ? cn("bg-canvas", md ? "translate-x-[18px]" : "translate-x-[16px]")
            : "translate-x-[2px] bg-ink-2",
        )}
      />
    </button>
  );
}

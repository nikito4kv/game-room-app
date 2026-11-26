import { cn } from "./cn";

/**
 * Крутилка загрузки. Анимируется только пока видна (идёт действие), в покое
 * её нет на экране. При prefers-reduced-motion вращение гасит глобальное
 * правило, остаётся статичная дуга — смысл «идёт работа» сохраняется.
 */
export function Spinner({
  size = 16,
  className,
  label,
}: {
  size?: number;
  className?: string;
  /** Подпись для скринридера. Без неё крутилка декоративная (aria-hidden). */
  label?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={cn("shrink-0 animate-spin", className)}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Заглушка контента на время загрузки — повторяет форму будущего блока.
 * Мягко «дышит» прозрачностью; при reduced-motion — статична.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("block rounded-item bg-wash-2 motion-safe:animate-pulse", className)}
    />
  );
}

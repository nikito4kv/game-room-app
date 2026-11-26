import type { ReactNode } from "react";
import { cn } from "./cn";
import { Icon, type IconName } from "./icons";

const TONE = {
  neutral: "bg-wash-2 text-ink-2",
  alert: "bg-alert-wash text-alert-ink",
  caution: "bg-caution-wash text-caution-ink",
} as const;

/** Над заголовком — значок или своя картинка: хотя бы что-то одно. */
type StateScreenPicture =
  | {
      icon: IconName;
      /** Своя картинка вместо значка (например, Румик). Есть она — значка нет. */
      visual?: ReactNode;
    }
  | { icon?: IconName; visual: NonNullable<ReactNode> };

/**
 * Экран-состояние по центру: 404, ошибка, «Связь потеряна», «Комнаты нет».
 * Правило: у каждого тупика есть главное действие, которое чинит ситуацию
 * («Попробовать снова», `Button primary block`), и запасное (`ghost`).
 * Технический текст ошибки на экран не выводим — только понятная причина.
 *
 * Над заголовком — `icon` в круге тона (`tone` красит только его) или
 * `visual`: картинка вместо значка, например `<Rumik sticker … />`. Под неё
 * место шириной min(210px, 60%): картинка без своего размера занимает его
 * целиком, группа шире выходит за края отрицательными полями. Картинка
 * декоративная (у Румика без `label` — aria-hidden): смысл несёт заголовок.
 *
 * Заголовок — h1 (это главный смысл экрана). Внутри карточки или макета, где
 * h1 уже есть, передайте `titleAs="h2"`.
 */
export function StateScreen({
  icon,
  visual,
  tone = "neutral",
  title,
  children,
  actions,
  titleAs: Title = "h1",
  className,
}: StateScreenPicture & {
  tone?: keyof typeof TONE;
  title: ReactNode;
  /** Пояснение, не длиннее двух строк. */
  children?: ReactNode;
  /** Кнопки во всю ширину: сначала главная, потом запасная. */
  actions?: ReactNode;
  titleAs?: "h1" | "h2";
  className?: string;
}) {
  const picture =
    visual != null && visual !== false ? (
      // Окно ниже 520 px (телефон боком): картинки нет, главная кнопка остаётся на экране.
      <div className="w-[min(210px,60%)] [@media(max-height:520px)]:hidden">{visual}</div>
    ) : icon ? (
      <span className={cn("grid size-14 place-items-center rounded-full", TONE[tone])}>
        <Icon name={icon} size={26} />
      </span>
    ) : null;
  return (
    <div className={cn("flex w-full max-w-[420px] flex-col items-center text-center", className)}>
      {picture}
      <Title className="mt-5 text-balance font-brand text-heading text-ink">{title}</Title>
      {children && <div className="mt-2 text-pretty text-body text-ink-2">{children}</div>}
      {actions && <div className="mt-6 flex w-full flex-col gap-2">{actions}</div>}
    </div>
  );
}

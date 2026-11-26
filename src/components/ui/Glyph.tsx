import { Icon, type IconName } from "./icons";
import { cn } from "./cn";

/**
 * Значок реакции, игры, звука или статуса: иконка из набора и/или короткий
 * текст («GG», число на кубике), в цвете смысла. Заменил эмодзи: те рисуются
 * шрифтом ОС, у каждой платформы по-своему и не попадают в стиль «Эфира».
 */
export type GlyphSpec = {
  icon?: IconName;
  /** Короткий текст рядом с иконкой или вместо неё. */
  text?: string;
  /** Класс цвета текста: text-signal-ink, text-caution-ink… */
  tone?: string;
};

export function Glyph({ spec, size = 20, className }: { spec: GlyphSpec; size?: number; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("inline-flex items-center gap-1 leading-none", spec.tone ?? "text-ink", className)}>
      {spec.icon && <Icon name={spec.icon} size={size} strokeWidth={2.1} />}
      {spec.text && <span className="font-brand text-body font-bold">{spec.text}</span>}
    </span>
  );
}

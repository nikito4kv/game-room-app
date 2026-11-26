import { cn } from "@/components/ui/cn";
import type { Level } from "../_lib/types";

const LABEL: Record<Level, string> = { bad: "красный", warn: "жёлтый", good: "зелёный" };

/**
 * Светофор: красный, жёлтый, зелёный сверху вниз; горит один. Цвета те же, что у
 * событий в системе: alert (плохо), caution (внимание), signal (хорошо).
 */
export function TrafficLight({ level, className }: { level: Level; className?: string }) {
  const lamp = (own: Level, lit: string) => (
    <span className={cn("size-6 rounded-full", level === own ? lit : "bg-wash-2")} />
  );
  return (
    <span
      role="img"
      aria-label={`Светофор: ${LABEL[level]}`}
      className={cn(
        "inline-flex shrink-0 flex-col gap-1.5 rounded-full border border-line bg-sunken p-1.5",
        className,
      )}
    >
      {lamp("bad", "bg-alert")}
      {lamp("warn", "bg-caution")}
      {lamp("good", "bg-signal")}
    </span>
  );
}

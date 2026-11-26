import { useMemo } from "react";
import { encode } from "uqr";
import { cn } from "./cn";

/** Путь SVG по тёмным модулям QR: по прямоугольнику на каждую тёмную полосу строки. */
export function qrPath(modules: readonly (readonly boolean[])[]): string {
  let d = "";
  modules.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) x++;
      d += `M${start} ${y}h${x - start}v1h${start - x}z`;
    }
  });
  return d;
}

/**
 * QR-код ссылки (приглашение в комнату для телефона). Тёмные модули на белой
 * плашке в обеих темах: светлый код на тёмном фоне часть камер не читает.
 * Тихая зона — три модуля, коррекция M (15 %): переживёт блик на экране.
 */
export function QrCode({
  value,
  label,
  size = 168,
  className,
}: {
  value: string;
  /** Что зашито — для скринридера («QR-код ссылки на комнату K7QMP4»). */
  label: string;
  size?: number;
  className?: string;
}) {
  const { d, n } = useMemo(() => {
    const qr = encode(value, { ecc: "M", border: 3 });
    return { d: qrPath(qr.data), n: qr.size };
  }, [value]);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${n} ${n}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={cn("shrink-0 rounded-item bg-white text-black", className)}
    >
      <path d={d} fill="currentColor" />
    </svg>
  );
}

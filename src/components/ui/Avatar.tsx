import type { CSSProperties } from "react";
import { avatarColorIndex, avatarColorVar, initialsOf } from "./avatarColor";
import { cn } from "./cn";
import { Icon, type IconName } from "./icons";
import { BODY, STROKE, VIEW } from "@/lib/rumik/geometry";
import { Rumik } from "./Rumik";

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";
/** Что показать значком в углу. Приоритет считает вызывающий код. */
export type AvatarStatus = "muted" | "deafened" | "forceMuted" | "ptt";
/** На какой поверхности лежит аватар — под цвет «выреза» вокруг значка. */
export type AvatarSurface = "canvas" | "raised" | "overlay";

const PX: Record<AvatarSize, number> = { xs: 24, sm: 32, md: 44, lg: 72, xl: 96 };
const RING: Record<AvatarSize, { width: number; gap: number }> = {
  xs: { width: 2, gap: 2 },
  sm: { width: 2, gap: 2 },
  md: { width: 2.5, gap: 2.5 },
  lg: { width: 3, gap: 3 },
  xl: { width: 3.5, gap: 3.5 },
};
const BADGE: Record<AvatarSize, number> = { xs: 0, sm: 15, md: 18, lg: 24, xl: 28 };

const STATUS: Record<AvatarStatus, { icon: IconName; cls: string; text: string }> = {
  muted: { icon: "mic-off", cls: "bg-overlay text-alert-ink", text: "микрофон выключен" },
  deafened: { icon: "headphones-off", cls: "bg-overlay text-alert-ink", text: "звук выключен" },
  forceMuted: { icon: "mic-off", cls: "bg-alert text-on-alert", text: "заглушён хостом" },
  ptt: { icon: "radio", cls: "bg-overlay text-ink-2", text: "в режиме рации" },
};

const CUTOUT: Record<AvatarSurface, string> = {
  canvas: "var(--gr-canvas)",
  raised: "var(--gr-raised)",
  overlay: "var(--gr-overlay)",
};

export type AvatarProps = {
  /** Ник: из него инициалы и (если не задан colorIndex) цвет. */
  name: string;
  /** Индекс цвета из assignAvatarColors — цвета в комнате без повторов. */
  colorIndex?: number;
  size?: AvatarSize;
  /** Говорит прямо сейчас — кольцо signal. */
  speaking?: boolean;
  /** Громкость 0…1 — кольцо «дышит» с голосом (transform/opacity). */
  level?: number;
  status?: AvatarStatus | null;
  surface?: AvatarSurface;
  /** Своя подпись для скринридера; по умолчанию «Ник, говорит, …». */
  label?: string;
  className?: string;
};

/**
 * Аватар участника: кружок цвета участника с инициалами, кольцо «говорит» и
 * значок состояния. Кольцо всегда в DOM и меняет только opacity/transform —
 * раскладка не дёргается, в тишине ничего не анимируется. Сила кольца идёт
 * за level, переходы сглаживают редкие замеры (раз в 100–200 мс).
 */
export function Avatar({
  name,
  colorIndex,
  size = "md",
  speaking = false,
  level = 0,
  status = null,
  surface = "canvas",
  label,
  className,
}: AvatarProps) {
  const px = PX[size];
  const ring = RING[size];
  const lvl = speaking ? Math.min(1, Math.max(0, level)) : 0;
  const initials = initialsOf(name);
  const color = avatarColorVar(colorIndex ?? avatarColorIndex(name));
  const st = status ? STATUS[status] : null;
  const badge = BADGE[size];
  const a11y =
    label ?? [name, speaking ? "говорит" : null, st ? st.text : null].filter(Boolean).join(", ");

  const ringInset = -(ring.gap + ring.width);
  const ringStyle: CSSProperties = {
    inset: ringInset,
    borderWidth: ring.width,
    opacity: speaking ? 0.75 + 0.25 * lvl : 0,
    transform: `scale(${speaking ? 1 + 0.05 * lvl : 0.94})`,
  };
  // Внешняя «волна»: тонкое кольцо, которое расходится тем дальше, чем
  // громче голос. Без размытия и теней — только opacity/scale.
  const waveStyle: CSSProperties = {
    inset: ringInset - Math.max(3, Math.round(px * 0.06)),
    borderWidth: Math.max(1.5, ring.width - 1),
    opacity: speaking ? 0.18 + 0.32 * lvl : 0,
    transform: `scale(${speaking ? 1 + 0.12 * lvl : 0.96})`,
  };

  return (
    <span
      role="img"
      aria-label={a11y}
      className={cn("relative inline-grid shrink-0 select-none place-items-center", className)}
      style={{ width: px, height: px }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute rounded-full border-solid border-signal transition-[opacity,transform] duration-[var(--gr-dur-level)] ease-swift"
        style={waveStyle}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute rounded-full border-solid border-signal transition-[opacity,transform] duration-[var(--gr-dur-level)] ease-swift"
        style={ringStyle}
      />
      <span
        aria-hidden="true"
        className="relative grid size-full place-items-center rounded-full font-brand font-semibold leading-none"
        style={{
          background: color,
          color: "var(--gr-avatar-ink)",
          fontSize: Math.round(px * (initials.length > 1 ? 0.34 : 0.42)),
        }}
      >
        {initials}
      </span>
      {badge > 0 && <StatusBadge status={status} px={badge} surface={surface} thin={size === "sm"} />}
    </span>
  );
}

/**
 * Значок состояния голоса в углу аватара или у фигуры Румика: тёмный кружок с
 * красной иконкой (сам выключил), красная заливка (хост заглушил), рация —
 * серым. Вырез цвета поверхности отделяет его от картинки. Без позиции: по
 * умолчанию — правый нижний угол, иначе className/style снаружи.
 */
export function StatusBadge({
  status,
  px,
  surface = "canvas",
  thin = false,
  corner = true,
  className,
  style,
}: {
  status: AvatarStatus | null;
  /** Диаметр, px; без него размер задают классы (size-5…). */
  px?: number;
  surface?: AvatarSurface;
  /** Вырез 2 px вместо 3 — для маленьких аватаров. */
  thin?: boolean;
  /** В правом нижнем углу (у аватара); false — позицию задают className/style. */
  corner?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  if (!status) return null;
  const st = STATUS[status];
  const offset = corner && px ? -Math.round(px * 0.18) : undefined;
  return (
    <span
      aria-hidden="true"
      className={cn("absolute grid place-items-center rounded-full", st.cls, className)}
      style={{
        width: px,
        height: px,
        right: offset,
        bottom: offset,
        boxShadow: `0 0 0 ${thin ? 2 : 3}px ${CUTOUT[surface]}`,
        ...style,
      }}
    >
      <Icon
        name={st.icon}
        size={px ? Math.round(px * 0.62) : 14}
        strokeWidth={2.4}
        className={px ? undefined : "size-[62%]"}
      />
    </span>
  );
}

export type RumikAvatarProps = {
  /** Ник: подпись для скринридера и (если не задан colorIndex) цвет. */
  name: string;
  colorIndex?: number;
  /** Рисунок человека (PNG Румика): тогда Румик белый под рисунком. */
  paint?: string | null;
  /** Размер из шкалы аватаров или ширина в px. */
  size?: AvatarSize | number;
  /** Говорит — лаймовое кольцо вокруг плитки. */
  speaking?: boolean;
  status?: AvatarStatus | null;
  surface?: AvatarSurface;
  label?: string;
  className?: string;
};

/**
 * Плитка аватара — тело Румика с обводкой (мировые координаты geometry.ts):
 * голова-квадрат с лицом во всю плитку, ноги и шапки за краем.
 */
const TILE = {
  x: BODY.x - STROKE / 2,
  y: BODY.y - STROKE / 2,
  w: BODY.w + STROKE,
  h: BODY.h + STROKE,
} as const;

/**
 * Аватар-голова Румика: плитка с лицом вместо кружка с инициалами — в стопках,
 * строках списка, ленте под сценой, мини-комнате. «Говорит» — лаймовое кольцо
 * вокруг плитки (обводка `glow` по силуэту на 24–44 px срезалась бы краем),
 * мьют — значок в углу, как у Avatar. От 40 px перечёркнутое кольцо в глазах
 * дублирует мьют; мельче глаза со смыслом не ставим (§8: не читаются).
 */
export function RumikAvatar({
  name,
  colorIndex,
  paint,
  size = "md",
  speaking = false,
  status = null,
  surface = "canvas",
  label,
  className,
}: RumikAvatarProps) {
  const px = typeof size === "number" ? size : PX[size];
  const st = status ? STATUS[status] : null;
  const badge = typeof size === "number" ? (px < 28 ? 0 : px < 40 ? 15 : px < 60 ? 18 : 24) : BADGE[size];
  const a11y =
    label ?? [name, speaking ? "говорит" : null, st ? st.text : null].filter(Boolean).join(", ");
  const muted = status === "muted" || status === "forceMuted";
  const s = px / TILE.w;
  const tileH = TILE.h * s;
  return (
    <span
      role="img"
      aria-label={a11y}
      className={cn("relative inline-grid shrink-0 select-none", className)}
      style={{ width: px, height: px }}
    >
      {/* Скругление — по форме тела: кисти и ноги, что торчат из-под углов, срезаны. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 overflow-hidden rounded-[35%]"
        style={{ top: (px - tileH) / 2, height: tileH }}
      >
        <Rumik
          size={VIEW.w * s}
          colors={paint ? "white" : (colorIndex ?? avatarColorIndex(name))}
          paint={paint ?? undefined}
          eyes={muted && px >= 40 ? "muted" : "normal"}
          className="absolute max-w-none"
          style={{ left: (VIEW.x - TILE.x) * s, top: (VIEW.y - TILE.y) * s }}
        />
      </span>
      {speaking && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute rounded-[36%] border-solid border-signal"
          style={{ inset: px < 40 ? -3 : -4, borderWidth: px < 40 ? 2 : 2.5 }}
        />
      )}
      {badge > 0 && <StatusBadge status={status} px={badge} surface={surface} thin={px < 40} />}
    </span>
  );
}

/**
 * Стопка аватаров: «уже в комнате» в лобби, недавние и открытые комнаты.
 * По умолчанию — головы Румиков (витрина и лобби, §8); `variant="initials"` —
 * кружки с инициалами (там, где Румиков выключили флагом). Перекрываются с
 * вырезом цвета поверхности, лишние — «+3». Если имена известны не у всех (витрина комнат знает только
 * хоста), `total` — сколько людей всего: «+N» досчитает тех, чьих имён нет.
 */
export function AvatarStack({
  people,
  max = 4,
  total,
  size = "sm",
  surface = "canvas",
  variant = "rumik",
  className,
}: {
  people: { name: string; colorIndex?: number; paint?: string | null }[];
  max?: number;
  /** Сколько людей всего, если их больше, чем в people. */
  total?: number;
  size?: Exclude<AvatarSize, "xl">;
  surface?: AvatarSurface;
  variant?: "rumik" | "initials";
  className?: string;
}) {
  const shown = people.slice(0, max);
  const rest = Math.max(people.length, total ?? 0) - shown.length;
  const px = PX[size];
  const rumik = variant === "rumik";
  const overlap = Math.round(px * 0.28);
  // Вырез цвета поверхности — по форме: кружок или плитка головы Румика.
  const shape = rumik ? "rounded-[32%]" : "rounded-full";
  const cut = `0 0 0 2px ${CUTOUT[surface]}`;
  return (
    <span className={cn("inline-flex items-center", className)}>
      {shown.map((p, i) => (
        <span
          key={`${p.name}-${i}`}
          className={cn("relative inline-grid", shape)}
          style={{ marginLeft: i === 0 ? 0 : -overlap, boxShadow: cut, zIndex: shown.length - i }}
        >
          {rumik ? (
            <RumikAvatar name={p.name} colorIndex={p.colorIndex} paint={p.paint} size={size} surface={surface} />
          ) : (
            <Avatar name={p.name} colorIndex={p.colorIndex} size={size} surface={surface} />
          )}
        </span>
      ))}
      {rest > 0 && (
        <span
          className={cn("relative grid place-items-center bg-wash-3 font-semibold text-ink-2 tabular-nums", shape)}
          style={{
            width: px,
            height: px,
            marginLeft: shown.length > 0 ? -overlap : 0,
            boxShadow: cut,
            fontSize: Math.round(px * 0.34),
          }}
          aria-label={`ещё ${rest}`}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}

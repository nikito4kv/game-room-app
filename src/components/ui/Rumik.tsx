import { useId, type CSSProperties, type ReactNode } from "react";
import {
  ARM,
  AXIS_X,
  BODY,
  EYE,
  HAND_R,
  HEAD_VIEW,
  LEG,
  PARTS,
  PLATE,
  POSES,
  STROKE,
  VIEW,
  handAt,
  armMirror,
  legSwing,
  partTransform,
  type RumikPose,
  type Shoulder,
} from "@/lib/rumik/geometry";
import { cn } from "./cn";

// Румик — маскот Game Room в стиле плоской наклейки (бренд-слой, DESIGN_SYSTEM.md §8).
// Один SVG вместо набора картинок: поза, глаза, головной убор и цвета — параметры.
// Цвета только из токенов: тело — палитра аватаров, лицо — тёмная плашка, глаза —
// кольцо и лаймовый круг из логотипа. Без JavaScript в браузере: годится и в
// серверных компонентах.

export type RumikEyes = "normal" | "wink" | "sleep" | "wide" | "muted" | "lost" | "speak";
export type RumikHat = "cap" | "beanie" | "crown" | "shades";
export type RumikExtra = "q" | "bang" | "zzz";
/**
 * Цвет тела: индекс палитры аватаров 0–9, до четырёх индексов по четвертям
 * (верх-слева, верх-справа, низ-справа, низ-слева) или "white" — некрашеный.
 */
export type RumikColors = number | readonly number[] | "white";

export const RUMIK_EYES: readonly RumikEyes[] = ["normal", "wink", "sleep", "wide", "muted", "lost", "speak"];
export const RUMIK_HATS: readonly RumikHat[] = ["cap", "beanie", "crown", "shades"];
export const RUMIK_EXTRAS: readonly RumikExtra[] = ["q", "bang", "zzz"];
export { RUMIK_ASPECT, RUMIK_POSES, type RumikPose } from "@/lib/rumik/geometry";

const INK = "var(--gr-avatar-ink)";
/**
 * Отражение — вокруг середины рамки, а не тела: рамка шире справа (там значки),
 * и так поднятая рука при flip не выходит за левый край рамки (как scaleX(-1)
 * у всего SVG в макете).
 */
const MIRROR_X = VIEW.x + VIEW.w / 2;
const EYE_LIGHT = "var(--gr-rumik-eye)";
const LIME = "var(--gr-signal)";

/** Индекс палитры аватаров 0–9: дробное округляется, лишнее заворачивается по кругу. */
export function rumikColorIndex(i: number): number {
  const n = Number.isFinite(i) ? Math.round(i) : 0;
  return ((n % 10) + 10) % 10;
}

const avatar = (i: number) => `var(--gr-avatar-${rumikColorIndex(i)})`;

/** Четыре цвета тела (CSS): верх-слева, верх-справа, низ-справа, низ-слева. */
export function rumikPalette(colors: RumikColors = 6): [string, string, string, string] {
  if (colors === "white") {
    const w = "var(--gr-rumik-white)";
    return [w, w, w, w];
  }
  const list = typeof colors === "number" ? [colors] : colors.slice(0, 4);
  const [c1 = avatar(6), c2 = c1, c3 = c2, c4 = c3] = list.map(avatar);
  return [c1, c2, c3, c4];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
const fill = (color: string): CSSProperties => ({ fill: color });
const ink: CSSProperties = { stroke: INK };

export type RumikProps = {
  colors?: RumikColors;
  pose?: RumikPose;
  eyes?: RumikEyes;
  hat?: RumikHat;
  /** Значок рядом: «?», «!», «Zz» (спит). */
  extra?: RumikExtra;
  /** Белый край наклейки вокруг силуэта. */
  sticker?: boolean;
  /** «Говорит»: тонкая лаймовая обводка по силуэту и мягкое свечение за фигурой. */
  glow?: boolean;
  /** Куда смотрят глаза: сдвиг [x, y] в координатах экрана (и при flip), не больше ±4. */
  look?: readonly [number, number];
  /** Наклон в градусах, не больше ±15. */
  tilt?: number;
  /** Отразить по горизонтали (смотрит в другую сторону); значки при этом читаются. */
  flip?: boolean;
  /** Ширина в px. Без неё Румик занимает всю ширину контейнера. */
  size?: number;
  /** Подпись для скринридера. Без неё Румик декоративный (aria-hidden). */
  label?: string;
  /**
   * Рисунок человека: PNG в рамке VIEW (286×240 или кратно), нарисованный на
   * стоящем Румике (рисовалка, /api/avatar). Ложится поверх `colors` по частям
   * тела и в других позах поворачивается вместе с руками и ногами. Лицо, глаза,
   * шапка и обводка — поверх рисунка, поэтому «мьют» и «говорит» видны и на нём.
   */
  paint?: string;
  /** «head» — квадратная рамка с головой (списки, стопки аватаров); по умолчанию вся фигура. */
  frame?: "full" | "head";
  className?: string;
  style?: CSSProperties;
};

/** Части силуэта в порядке отрисовки: ноги, руки, тело, кисти. Без цвета — его дают снаружи. */
function silhouette(pose: Shoulder[], swing: number): ReactNode[] {
  const [hl, hr] = pose.map(handAt);
  return [
    <rect key="ll" {...legProps(LEG.left, swing)} />,
    <rect key="lr" {...legProps(LEG.right, -swing)} />,
    <rect key="al" {...armProps(pose[0])} />,
    <rect key="ar" {...armProps(pose[1])} />,
    <rect key="b" x={BODY.x} y={BODY.y} width={BODY.w} height={BODY.h} rx={BODY.r} />,
    <circle key="hl" cx={round1(hl[0])} cy={round1(hl[1])} r={HAND_R} />,
    <circle key="hr" cx={round1(hr[0])} cy={round1(hr[1])} r={HAND_R} />,
  ];
}

function legProps(x: number, swing: number) {
  return {
    x,
    y: LEG.y,
    width: LEG.w,
    height: LEG.h,
    rx: LEG.r,
    transform: swing ? `rotate(${swing} ${x + LEG.w / 2} 140)` : undefined,
  };
}

function armProps([x, y, angle]: Shoulder) {
  return {
    x: -ARM.w / 2,
    y: ARM.top,
    width: ARM.w,
    height: ARM.h,
    rx: ARM.r,
    transform: `translate(${x} ${y}) rotate(${angle})`,
  };
}

function Eyes({ kind, look }: { kind: RumikEyes; look: readonly [number, number] }) {
  const { ring, dot, stroke } = EYE;
  const light = { strokeWidth: stroke, strokeLinecap: "round" as const, fill: "none" };
  const ringEl = (r: number = ring.r) => <circle cx={ring.x} cy={ring.y} r={r} {...light} style={{ stroke: EYE_LIGHT }} />;
  const dotEl = (r: number = dot.r) => <circle cx={dot.x} cy={dot.y} r={r} style={fill(LIME)} />;
  let inner: ReactNode;
  switch (kind) {
    case "wink":
      inner = (
        <>
          <path d="M68 76 Q80 62 92 76" {...light} style={{ stroke: EYE_LIGHT }} />
          {dotEl()}
        </>
      );
      break;
    case "sleep":
      inner = (
        <>
          <path d="M69 72 H91" {...light} style={{ stroke: EYE_LIGHT }} />
          <path d="M111 71 H133" strokeWidth={4.4} strokeLinecap="round" style={{ stroke: LIME }} />
        </>
      );
      break;
    case "wide":
      inner = (
        <>
          {ringEl(12.5)}
          {dotEl(13.5)}
        </>
      );
      break;
    case "muted":
      inner = (
        <>
          {ringEl()}
          <path d="M70 82 L90 62" strokeWidth={4.2} strokeLinecap="round" style={{ stroke: "var(--gr-alert)" }} />
          {dotEl()}
        </>
      );
      break;
    case "lost":
      inner = (
        <>
          <path d="M70 66 L90 78 M90 66 L70 78" {...light} style={{ stroke: EYE_LIGHT }} />
          {dotEl(9.5)}
        </>
      );
      break;
    case "speak":
      // Лаймовый круг крупнее (язык глаз из 07). Это выражение для картинок, а не
      // индикатор «говорит» в комнате: там обводка glow и значок у головы (R3).
      inner = (
        <>
          {ringEl()}
          {dotEl(14.5)}
        </>
      );
      break;
    default:
      inner = (
        <>
          {ringEl()}
          {dotEl()}
        </>
      );
  }
  const dx = clamp(look[0], -4, 4);
  const dy = clamp(look[1], -4, 4);
  return dx || dy ? <g transform={`translate(${dx} ${dy})`}>{inner}</g> : <>{inner}</>;
}

function Hat({ kind }: { kind: RumikHat }) {
  const outline = { strokeWidth: STROKE, strokeLinejoin: "round" as const };
  switch (kind) {
    case "cap":
      return (
        <>
          <path d="M52 24 Q52 -6 100 -6 Q148 -6 148 24 Z" {...outline} style={{ ...ink, ...fill(avatar(0)) }} />
          <rect x={98} y={12} width={72} height={14} rx={7} {...outline} style={{ ...ink, ...fill(avatar(0)) }} />
        </>
      );
    case "beanie":
      return (
        <>
          <path d="M50 28 Q50 -8 100 -8 Q150 -8 150 28 Z" {...outline} style={{ ...ink, ...fill(avatar(8)) }} />
          <rect x={45} y={19} width={110} height={17} rx={8.5} {...outline} style={{ ...ink, ...fill(avatar(9)) }} />
          <circle cx={100} cy={-10} r={9} {...outline} style={{ ...ink, ...fill(avatar(9)) }} />
        </>
      );
    case "crown":
      return (
        <path
          d="M58 24 L64 -6 L82 10 L100 -14 L118 10 L136 -6 L142 24 Z"
          {...outline}
          style={{ ...ink, ...fill("var(--gr-crown)") }}
        />
      );
    case "shades": {
      const frame = { stroke: avatar(2), fill: INK };
      return (
        <>
          <rect x={58} y={60} width={38} height={22} rx={9} strokeWidth={3.4} style={frame} />
          <rect x={104} y={60} width={38} height={22} rx={9} strokeWidth={3.4} style={frame} />
          <path d="M96 70 H104" strokeWidth={3.4} style={{ stroke: avatar(2) }} />
        </>
      );
    }
  }
}

/** Значок «?» или «!» в скруглённом квадрате над плечом. Центр — (cx, 12). */
function Bubble({ text, color, cx, angle }: { text: string; color: string; cx: number; angle: number }) {
  return (
    <g transform={`translate(${cx} 12) rotate(${angle}) translate(-23 -23)`}>
      <rect width={46} height={46} rx={15} strokeWidth={4} style={{ ...ink, ...fill(color) }} />
      <text
        x={23}
        y={34}
        textAnchor="middle"
        fontSize={28}
        fontWeight={700}
        className="font-brand"
        style={fill(INK)}
      >
        {text}
      </text>
    </g>
  );
}

/**
 * Значки, которые не отражаются вместе с фигурой: текст должен читаться. При
 * flip их место зеркалится вместе с фигурой, а буквы — нет.
 */
function Extra({ kind, flip }: { kind: RumikExtra; flip: boolean }) {
  const mx = (x: number) => (flip ? 2 * MIRROR_X - x : x);
  const tilt = flip ? -8 : 8;
  if (kind === "q") return <Bubble text="?" color={avatar(2)} cx={mx(180)} angle={tilt} />;
  if (kind === "bang") return <Bubble text="!" color={avatar(1)} cx={mx(180)} angle={tilt} />;
  if (kind === "zzz") {
    return (
      <g className="font-brand" fontWeight={700} textAnchor="middle" style={fill("var(--gr-ink)")}>
        <text x={mx(159)} y={8} fontSize={26}>
          Z
        </text>
        <text x={mx(182)} y={-12} fontSize={19}>
          z
        </text>
      </g>
    );
  }
  return null;
}

/**
 * Маскот Румик. Декоративный по умолчанию (aria-hidden); с `label` — картинка
 * со смыслом. Размер — `size` (ширина в px) или ширина контейнера.
 *
 * Пример: `<Rumik colors={[6, 5, 4, 2]} pose="wave" sticker hat="cap" />`.
 */
export function Rumik({
  colors,
  pose = "stand",
  eyes = "normal",
  hat,
  extra,
  sticker = false,
  glow = false,
  look = [0, 0],
  tilt = 0,
  flip = false,
  size,
  label,
  paint,
  frame = "full",
  className,
  style,
}: RumikProps) {
  // Свой префикс id у каждого Румика: на странице их много, а clipPath и <use>
  // ищут элемент по id во всём документе. Счётчик useId в серверном рендере свой у
  // каждого сегмента Next, поэтому в id ещё и поза: если id всё же совпадут, внутри
  // будет тот же силуэт (а обрезка тела и свечение у всех Румиков одинаковые).
  const uid = `rk${pose}${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [c1, c2, c3, c4] = rumikPalette(colors);
  const p = POSES[pose] ?? POSES.stand;
  const swing = legSwing(pose);
  const quad = c1 !== c2 || c2 !== c3 || c3 !== c4;
  const angle = clamp(tilt, -15, 15);

  const parts = silhouette([p.l, p.r], swing);
  const outline = { strokeWidth: STROKE, strokeLinejoin: "round" as const };
  // Рисунок части: картинка в рамке VIEW, обрезанная формой части в позе «стоит»
  // и перенесённая в текущую позу. Обводка — после, поверх краски.
  const image = paint ? (
    <image href={paint} x={VIEW.x} y={VIEW.y} width={VIEW.w} height={VIEW.h} preserveAspectRatio="none" />
  ) : null;
  const painted = (i: number) => {
    if (!paint) return null;
    const part = PARTS[i];
    const arm = part === "armL" || part === "armR";
    return (
      <g transform={partTransform(pose, part)}>
        <g clipPath={`url(#${uid}p${i})`}>
          {arm ? (
            <>
              {/* Спрятанная за телом половина руки — отражением видимой. */}
              <g clipPath={`url(#${uid}b)`}>
                <g transform={armMirror(part)}>{image}</g>
              </g>
              <g mask={`url(#${uid}m)`}>{image}</g>
            </>
          ) : (
            image
          )}
        </g>
      </g>
    );
  };
  // Цвета частей: ноги и руки — нижние четверти тела, кисти — верхние.
  const colored = (i: number, color: string) =>
    paint ? (
      <g key={i}>
        <g style={fill(color)}>{parts[i]}</g>
        {painted(i)}
        <g {...outline} style={{ ...ink, fill: "none" }}>
          {parts[i]}
        </g>
      </g>
    ) : (
      <g key={i} {...outline} style={{ ...ink, ...fill(color) }}>
        {parts[i]}
      </g>
    );
  const standParts = paint ? silhouette([POSES.stand.l, POSES.stand.r], 0) : null;

  const border = glow ? (
    <use href={`#${uid}s`} strokeWidth={12} strokeLinejoin="round" style={{ fill: LIME, stroke: LIME }} />
  ) : sticker ? (
    <use
      href={`#${uid}s`}
      strokeWidth={19}
      strokeLinejoin="round"
      style={{ fill: "var(--gr-rumik-sticker)", stroke: "var(--gr-rumik-sticker)" }}
    />
  ) : null;

  const figure = (
    <>
      {/* Мягкое свечение «говорит» — за фигурой и вместе с ней отражается. */}
      {glow && <ellipse cx={AXIS_X} cy={102} rx={140} ry={116} fill={`url(#${uid}g)`} />}
      {border}
      {colored(0, c4)}
      {colored(1, c3)}
      {colored(2, c4)}
      {colored(3, c3)}
      <rect x={BODY.x} y={BODY.y} width={BODY.w} height={BODY.h} rx={BODY.r} style={fill(c1)} />
      {quad && (
        <g clipPath={`url(#${uid}c)`}>
          <rect x={AXIS_X} y={0} width={80} height={82} style={fill(c2)} />
          <rect x={AXIS_X} y={82} width={80} height={80} style={fill(c3)} />
          <rect x={0} y={82} width={AXIS_X} height={80} style={fill(c4)} />
        </g>
      )}
      {painted(4)}
      <rect x={BODY.x} y={BODY.y} width={BODY.w} height={BODY.h} rx={BODY.r} fill="none" {...outline} style={ink} />
      <rect x={PLATE.x} y={PLATE.y} width={PLATE.w} height={PLATE.h} rx={PLATE.r} style={fill(INK)} />
      {/* Фигура при flip отражена вместе с глазами — взгляд переворачиваем обратно. */}
      <Eyes kind={eyes} look={flip ? [-look[0], look[1]] : look} />
      {hat && <Hat kind={hat} />}
      {colored(5, c1)}
      {colored(6, c2)}
    </>
  );

  const view = frame === "head" ? HEAD_VIEW : VIEW;
  return (
    <svg
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      width={size}
      height={size === undefined ? undefined : round1((size * view.h) / view.w)}
      overflow="visible"
      focusable="false"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("block shrink-0", size === undefined && "h-auto w-full", className)}
      style={style}
    >
      <defs>
        <g id={`${uid}s`}>{parts}</g>
        {quad && (
          <clipPath id={`${uid}c`}>
            <rect x={BODY.x} y={BODY.y} width={BODY.w} height={BODY.h} rx={BODY.r} />
          </clipPath>
        )}
        {standParts?.map((part, i) => (
          <clipPath key={i} id={`${uid}p${i}`}>
            {part}
          </clipPath>
        ))}
        {paint && (
          <>
            <clipPath id={`${uid}b`}>
              <rect x={BODY.x} y={BODY.y} width={BODY.w} height={BODY.h} rx={BODY.r} />
            </clipPath>
            {/* Всё, кроме тела: видимая в позе «стоит» часть руки. */}
            <mask id={`${uid}m`} maskUnits="userSpaceOnUse" x={VIEW.x} y={VIEW.y} width={VIEW.w} height={VIEW.h}>
              <rect x={VIEW.x} y={VIEW.y} width={VIEW.w} height={VIEW.h} style={{ fill: "white" }} />
              <rect x={BODY.x} y={BODY.y} width={BODY.w} height={BODY.h} rx={BODY.r} style={{ fill: "black" }} />
            </mask>
          </>
        )}
        {glow && (
          <radialGradient id={`${uid}g`}>
            <stop offset="0" stopOpacity={0.3} style={{ stopColor: LIME }} />
            <stop offset="0.58" stopOpacity={0.12} style={{ stopColor: LIME }} />
            <stop offset="1" stopOpacity={0} style={{ stopColor: LIME }} />
          </radialGradient>
        )}
      </defs>
      <g transform={angle ? `rotate(${angle} 100 110)` : undefined}>
        {flip ? <g transform={`matrix(-1 0 0 1 ${2 * MIRROR_X} 0)`}>{figure}</g> : figure}
        {extra && <Extra kind={extra} flip={flip} />}
      </g>
    </svg>
  );
}

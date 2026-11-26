import type { CSSProperties, ReactNode } from "react";
import { Avatar, StatusBadge, type AvatarStatus } from "./Avatar";
import { avatarColorIndex } from "./avatarColor";
import { cn } from "./cn";
import { Icon } from "./icons";
import { Rumik } from "./Rumik";
import {
  EMPTY_TABLE_SCALE,
  SEAT_BADGES,
  SEAT_FIGURE,
  SEAT_HEAD,
  SEAT_LABEL,
  arenaCenterBox,
  arenaLayout,
  arenaTableBox,
  labelAbove,
  seatAngles,
  seatPoint,
  speakingBadgeSpot,
  type ArenaBox,
  type ArenaSeat,
} from "./tableLayout";
import type { RumikPose } from "@/lib/rumik/geometry";

/** Человек за мини-столом. */
export type TableGuest = {
  name: string;
  /** Индекс цвета из assignAvatarColors; без него — цвет по нику. */
  colorIndex?: number;
  /** Рисунок Румика (PNG): тогда Румик белый под рисунком. */
  paint?: string | null;
  speaking?: boolean;
  level?: number;
  status?: AvatarStatus | null;
  /** Корона перед именем. */
  host?: boolean;
  /** Это вы: место внизу, ближе к зрителю, и «· вы» после ника. */
  me?: boolean;
};

/* --------------------------------------------- Арена: стол под углом */

const pct = (v: number) => `${Math.round(v * 1000) / 1000}%`;

function boxStyle(b: ArenaBox): CSSProperties {
  return { left: pct(b.left), top: pct(b.top), width: pct(b.width), height: pct(b.height) };
}

/**
 * Стол под углом (комната и мини-стол): свет лампы, стол-эллипс, центр и места.
 * Места — дети, каждое в обёртке со стилем arenaSeatStyle. Пропорция 16:11,
 * ширину задаёт className (обычно по контейнеру: стол выбирается по высоте
 * окна). Арена — контейнер `arena`: подписи и значки мест крупнеют от 700 px.
 * Центр — контейнер `center` (size): содержимое прячет лишнее по его высоте.
 */
export function TableArena({
  center,
  tableScale = 1,
  className,
  children,
}: {
  /** Что лежит в центре стола: код, «Пока тут только вы»… */
  center?: ReactNode;
  /** Стол крупнее обычного — когда за ним никого (EMPTY_TABLE_SCALE). */
  tableScale?: number;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("@container/arena relative aspect-[16/11]", className)}>
      {/* Свет лампы над столом: статичный градиент, рисуется один раз. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-[4%] rounded-full bg-[radial-gradient(closest-side,var(--gr-glow),transparent)]"
      />
      <div
        aria-hidden="true"
        className="absolute rounded-[50%] border border-line bg-wash-1 bg-[radial-gradient(closest-side,transparent_62%,var(--gr-wash-2))] shadow-[inset_0_0_0_6px_var(--gr-wash-1)]"
        style={boxStyle(arenaTableBox(tableScale))}
      />
      {center && (
        <div
          className="absolute grid place-items-center text-center [container:center/size]"
          style={boxStyle(arenaCenterBox(tableScale))}
        >
          {center}
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * Обёртка места на арене: ширина рамки Румика, подошвы — в точке на эллипсе,
 * ближние места поверх дальних.
 */
export function arenaSeatStyle(seat: ArenaSeat, seatWidth: number): CSSProperties {
  return {
    left: pct(seat.left),
    top: pct(seat.top),
    width: pct(seatWidth),
    zIndex: seat.z,
    transform: `translate(${pct(-SEAT_FIGURE.axis * 100)}, ${pct(-SEAT_FIGURE.feet * 100)})`,
  };
}

/** Рамка Румика на месте: пропорция VIEW, всё остальное места — absolute от неё. */
export const SEAT_FRAME_CLASS = "relative block aspect-[286/240] w-full";

/** Голова Румика в рамке (тело без ног) — сюда ставят пузырь реакции. */
export const SEAT_HEAD_STYLE: CSSProperties = {
  left: pct(SEAT_HEAD.left * 100),
  top: pct(SEAT_HEAD.top * 100),
  width: pct(SEAT_HEAD.width * 100),
  height: pct(SEAT_HEAD.height * 100),
};

/**
 * Значок «говорит» у головы: лаймовый кружок с полосками. Его видят и те, кто
 * плохо различает цвета, — обводка `glow` одна была бы только цветом. pose —
 * текущая поза Румика: если правая кисть поднята (жест реакции), значок уходит
 * к правому боку и кисть не закрывает (speakingBadgeSpot).
 */
export function SpeakingBadge({ pose }: { pose?: RumikPose }) {
  const spot = speakingBadgeSpot(pose);
  return (
    <span
      aria-hidden="true"
      className="absolute grid size-5 place-items-center rounded-full bg-signal text-on-signal shadow-[0_0_0_3px_var(--gr-canvas)] @[700px]/arena:size-[26px]"
      style={{ left: pct(spot.left * 100), top: pct(spot.top * 100) }}
    >
      <Icon name="audio-lines" size={12} strokeWidth={2.6} className="@[700px]/arena:size-4" />
    </span>
  );
}

/** Значок мьюта у руки Румика — как в углу аватара. */
export function SeatStatusBadge({ status }: { status: AvatarStatus | null }) {
  return (
    <StatusBadge
      status={status}
      corner={false}
      className="size-5 @[700px]/arena:size-6"
      style={{ left: pct(SEAT_BADGES.muted.left * 100), top: pct(SEAT_BADGES.muted.top * 100) }}
    />
  );
}

/**
 * Подпись места — одна строка (корона, ник, значки, связь) под подошвами или
 * над головой у дальних мест. Не шире места × 1,1 — так подписи соседей не
 * сходятся (labelWidth в arenaLayout). У говорящего подпись под ногами на арене
 * от 700 px (SEAT_LABEL.shiftFromPx) опускается на SEAT_LABEL.speakingShiftPx
 * (translate-y-1.5 = 6 px), чтобы лаймовая обводка и свечение не закрывали ник;
 * над головой свечение до подписи не достаёт. Сдвиг — transform 180 мс, при
 * «меньше движения» сразу.
 */
export function SeatLabel({
  above,
  speaking = false,
  children,
}: {
  above: boolean;
  speaking?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "absolute flex max-w-[110%] -translate-x-1/2 items-center justify-center gap-1 whitespace-nowrap font-medium text-ink",
        "text-label [text-shadow:0_1px_3px_var(--gr-canvas)] @[760px]/arena:text-body",
        !above && "transition-[translate] duration-180 ease-swift motion-reduce:transition-none",
        !above && speaking && "@[700px]/arena:translate-y-1.5",
      )}
      style={
        above
          ? {
              left: pct(SEAT_FIGURE.axis * 100),
              bottom: `calc(${pct((1 - SEAT_BADGES.speaking.top) * 100)} + ${SEAT_LABEL.gapPx}px)`,
            }
          : { left: pct(SEAT_FIGURE.axis * 100), top: `calc(${pct(SEAT_FIGURE.feet * 100)} + ${SEAT_LABEL.gapPx}px)` }
      }
    >
      {children}
    </span>
  );
}

/* ---------------------------------------------------------- Мини-стол */

const SEAT = {
  // Центр аватара должен попасть точно в точку на окружности: сдвигаем место
  // на верхний отступ (8) + половину аватара (md 22, lg 36).
  md: { avatar: "md", width: "w-28", name: "max-w-[104px] text-label", lift: 30 },
  lg: { avatar: "lg", width: "w-36", name: "max-w-[128px] text-body", lift: 44 },
} as const;

/**
 * Мини-стол: картинка, а не управление — лендинг («вот как это выглядит») и
 * лобби («кто уже внутри»). Румики стоят по эллипсу вокруг стола под углом, как
 * в комнате; `variant="avatars"` — прежний круглый стол с кружками (если Румиков
 * выключили флагом rumik_table). Ничего не движется само: «говорит» стоит, пока
 * не меняется speaking.
 *
 * Размер — от контейнера: положите стол в блок с `[container-type:size]`, он
 * займёт его по ширине или по высоте (не шире 600 px). Без `label` стол и люди
 * декоративные (aria-hidden): смысл рядом должен быть текстом. `center` —
 * обычное содержимое, его видит и скринридер: туда можно класть кнопку
 * («Пригласить» в лобби пустой комнаты).
 */
export function TablePreview({
  people,
  seat = "md",
  variant = "rumik",
  center,
  label,
  className,
}: {
  people: TableGuest[];
  /** Только для variant="avatars": размер кружков. */
  seat?: "md" | "lg";
  variant?: "rumik" | "avatars";
  /** Что лежит в центре стола: код, «Пока тут только вы»… */
  center?: ReactNode;
  /** Подпись для скринридера: «Тёма, Ника и Лёха уже в комнате». */
  label?: string;
  className?: string;
}) {
  if (variant === "avatars") {
    return <RoundPreview people={people} seat={seat} center={center} label={label} className={className} />;
  }
  const self = people.findIndex((p) => p.me);
  const arena = arenaLayout(people.length, Math.max(0, self));
  return (
    <TableArena
      center={center}
      tableScale={people.length === 0 ? EMPTY_TABLE_SCALE : 1}
      className={cn("w-[min(600px,100cqw,calc(100cqh*16/11))]", className)}
    >
      {/* Люди — отдельным слоем: его role="img" или aria-hidden не должны
          прятать содержимое центра. */}
      <div role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
        {people.map((p, i) => {
          const s = arena.seats[i];
          const muted = p.status === "muted" || p.status === "forceMuted";
          return (
            <div key={`${p.name}-${i}`} className="absolute" style={arenaSeatStyle(s, arena.seatWidth)}>
              <div className={SEAT_FRAME_CLASS}>
                <Rumik
                  colors={p.paint ? "white" : (p.colorIndex ?? avatarColorIndex(p.name))}
                  paint={p.paint ?? undefined}
                  glow={p.speaking}
                  eyes={muted ? "muted" : "normal"}
                  look={s.look}
                />
                {p.speaking && <SpeakingBadge />}
                <SeatStatusBadge status={p.status ?? null} />
                <SeatLabel above={s.labelAbove} speaking={p.speaking}>
                  {p.host && <Icon name="crown" size={14} className="shrink-0 text-crown" />}
                  <span className="truncate">{p.name}</span>
                  {p.me && <span className="shrink-0 font-normal text-ink-3">· вы</span>}
                </SeatLabel>
              </div>
            </div>
          );
        })}
      </div>
    </TableArena>
  );
}

/** Прежний мини-стол: кружки по окружности, подпись снаружи стола. */
function RoundPreview({
  people,
  seat,
  center,
  label,
  className,
}: {
  people: TableGuest[];
  seat: "md" | "lg";
  center?: ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative aspect-square w-[min(84cqmin,600px)]", className)}>
      {/* Картинка (свет, стол, люди) — отдельным слоем: её role="img" или
          aria-hidden не должны прятать содержимое центра. */}
      <div
        role={label ? "img" : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        className="absolute inset-0"
      >
        {/* Свет лампы над столом: статичный градиент, рисуется один раз. */}
        <div className="pointer-events-none absolute -inset-[12%] rounded-full bg-[radial-gradient(closest-side,var(--gr-glow),transparent)]" />
        <div className="absolute inset-[26%] rounded-full border border-line bg-[radial-gradient(closest-side,transparent_62%,var(--gr-wash-2))] shadow-[inset_0_0_0_6px_var(--gr-wash-1)]" />
        <TableSeats people={people} seat={seat} />
      </div>
      {center && <div className="absolute inset-[29%] grid place-items-center text-center">{center}</div>}
    </div>
  );
}

/** Люди по кругу; подпись снаружи стола. */
function TableSeats({ people, seat }: { people: TableGuest[]; seat: "md" | "lg" }) {
  const size = SEAT[seat];
  const angles = seatAngles(people.length);
  return (
    <>
      {people.map((p, i) => {
        const point = seatPoint(angles[i]);
        const above = labelAbove(angles[i]);
        const style: CSSProperties = {
          left: `${point.left}%`,
          top: `${point.top}%`,
          // Подпись над аватаром — аватар внизу места, сдвиг считаем от низа.
          transform: `translate(-50%, ${above ? `calc(-100% + ${size.lift}px)` : `-${size.lift}px`})`,
        };
        return (
          <div
            key={`${p.name}-${i}`}
            className={cn(
              "absolute flex items-center gap-1.5 px-2 py-2 text-center",
              above ? "flex-col-reverse" : "flex-col",
              size.width,
            )}
            style={style}
          >
            <Avatar
              name={p.name}
              colorIndex={p.colorIndex}
              size={size.avatar}
              speaking={p.speaking}
              level={p.level}
              status={p.status}
            />
            <span className={cn("flex min-w-0 items-center gap-1 font-medium text-ink", size.name)}>
              {p.host && <Icon name="crown" size={14} className="shrink-0 text-crown" />}
              <span className="truncate">{p.name}</span>
            </span>
          </div>
        );
      })}
    </>
  );
}

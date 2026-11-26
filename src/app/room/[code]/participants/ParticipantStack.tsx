"use client";

import { useLayoutEffect, useState, type ReactNode, type Ref, type RefObject } from "react";
import type { Participant } from "livekit-client";
import { avatarColorIndex, cn, labelAbove, seatAngles, seatPoint } from "@/components/ui";
import { TableArena, arenaSeatStyle } from "@/components/ui/TablePreview";
import { arenaLayout } from "@/components/ui/tableLayout";
import { tableSeatSize, zoneLayout, type ZoneLayout } from "@/lib/room/zoneLayout";
import { ParticipantSeat, SelfSeat, useRumikTable, type SeatLayout } from "./ParticipantCircle";
import { displayName } from "./useAvatarColors";

// Раскладки участников в зоне комнаты: стол, ряд, список и лента под сценой.
// В DOM всегда ровно одна — иначе задвоятся data-testid="participant".
// С флагом rumik_table за столом и в ряду стоят Румики, в списке и ленте —
// их головы; без флага — прежние кружки.

/** Всё, что нужно местам. Пропсы мест — примитивы, поэтому memo мест работает. */
export type SeatsModel = {
  /** В порядке входа. */
  people: readonly Participant[];
  colors: ReadonlyMap<string, number>;
  hostIdentity: string | null;
  /** «Заглушить для себя»: identity → да. */
  mutes: Readonly<Record<string, boolean>>;
  /** Открыть панель участника (стабильная ссылка). */
  onOpen: (p: Participant, el: HTMLElement) => void;
};

/** Место участника в нужном виде; своё — через SelfSeat (свои «звук выкл» и рация). */
function Seat({
  model,
  p,
  layout,
  above,
  look,
}: {
  model: SeatsModel;
  p: Participant;
  layout: SeatLayout;
  above?: boolean;
  /** Куда смотрит Румик за столом: к центру. */
  look?: readonly [number, number];
}) {
  const name = displayName(p);
  const common = {
    p,
    name,
    colorIndex: model.colors.get(p.identity) ?? avatarColorIndex(name),
    host: p.identity === model.hostIdentity,
    layout,
    labelAbove: above,
    lookX: look?.[0],
    lookY: look?.[1],
  };
  if (p.isLocal) return <SelfSeat {...common} me mutedForMe={false} />;
  return <ParticipantSeat {...common} me={false} mutedForMe={!!model.mutes[p.identity]} onOpen={model.onOpen} />;
}

/**
 * Раскладка по размеру зоны. ResizeObserver срабатывает только при смене
 * размера — в покое ничего не считается.
 */
export function useZoneLayout(ref: RefObject<HTMLElement | null>): ZoneLayout {
  const [layout, setLayout] = useState<ZoneLayout>("table");
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setLayout(zoneLayout(width, height));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return layout;
}

/**
 * Стол (зона ≥ 560×540); в центре — состояние комнаты (код, «Пока тут только
 * вы», свой показ). Размер — от контейнера с [container-type:size]: стол сам
 * ужимается, когда открыт чат, и выбирается по высоте окна.
 *
 * С флагом rumik_table — стол под углом: Румики одного размера по эллипсу,
 * свой — внизу, ближе к зрителю; подпись у дальних мест над головой. Без флага —
 * прежний круглый стол с кружками.
 */
export function RoundTable({ model, center }: { model: SeatsModel; center: ReactNode }) {
  return useRumikTable() ? <ArenaTable model={model} center={center} /> : <CircleTable model={model} center={center} />;
}

/** Стол под углом с Румиками (arenaLayout в @/components/ui/tableLayout). */
function ArenaTable({ model, center }: { model: SeatsModel; center: ReactNode }) {
  const self = model.people.findIndex((p) => p.isLocal);
  const arena = arenaLayout(model.people.length, Math.max(0, self));
  return (
    <TableArena center={center} className="w-[min(1100px,100cqw,calc(100cqh*16/11))]">
      <ul className="contents" aria-label="Участники">
        {model.people.map((p, i) => {
          const s = arena.seats[i];
          return (
            <li key={p.identity} className="absolute" style={arenaSeatStyle(s, arena.seatWidth)}>
              <Seat model={model} p={p} layout="figure" above={s.labelAbove} look={s.look} />
            </li>
          );
        })}
      </ul>
    </TableArena>
  );
}

/** Прежний круглый стол: кружки по окружности, подпись всегда снаружи стола. */
function CircleTable({ model, center }: { model: SeatsModel; center: ReactNode }) {
  const n = model.people.length;
  const seat = tableSeatSize(n);
  // Центр аватара — точно в точке на окружности: верхний отступ места (8) +
  // половина аватара (lg 36, md 22). У верхних мест аватар внизу места.
  const lift = seat === "lg" ? 44 : 30;
  const angles = seatAngles(n);
  return (
    <div className="relative aspect-square w-[min(84cqmin,600px)]">
      {/* Свет лампы над столом: статичный градиент, рисуется один раз. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-[12%] rounded-full bg-[radial-gradient(closest-side,var(--gr-glow),transparent)]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-[26%] rounded-full border border-line bg-[radial-gradient(closest-side,transparent_62%,var(--gr-wash-2))] shadow-[inset_0_0_0_6px_var(--gr-wash-1)]"
      />
      <div className="absolute inset-[29%] grid place-items-center text-center">{center}</div>
      <ul className="contents" aria-label="Участники">
        {model.people.map((p, i) => {
          const point = seatPoint(angles[i]);
          const above = labelAbove(angles[i]);
          return (
            <li
              key={p.identity}
              className="absolute"
              style={{
                left: `${point.left}%`,
                top: `${point.top}%`,
                transform: `translate(-50%, ${above ? `calc(-100% + ${lift}px)` : `-${lift}px`})`,
              }}
            >
              <Seat model={model} p={p} layout={seat} above={above} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Низкое широкое окно: стол не помещается — все в ряд, как на диване. Румики
 * во весь рост, подпись под ногами (место под неё — нижний отступ).
 */
export function SeatRow({ model }: { model: SeatsModel }) {
  const rumik = useRumikTable();
  return (
    <ul
      className={cn("flex flex-wrap items-start justify-center", rumik ? "gap-x-4 gap-y-8" : "gap-2")}
      aria-label="Участники"
    >
      {model.people.map((p) => (
        <li key={p.identity} className={rumik ? "w-28 pb-6" : undefined}>
          <Seat model={model} p={p} layout={rumik ? "figure" : "lg"} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Узкое окно сбоку от игры: список, как голосовой канал Discord. ref — на сам
 * список: под его последней строкой встают тосты (useToastTop).
 */
export function SeatList({ model, ref }: { model: SeatsModel; ref?: Ref<HTMLUListElement> }) {
  return (
    <ul ref={ref} className="flex flex-col gap-0.5 px-2 py-2" aria-label="Участники">
      {model.people.map((p) => (
        <li key={p.identity}>
          <Seat model={model} p={p} layout="list" />
        </li>
      ))}
    </ul>
  );
}

/** Лента участников под сценой показа экрана; lead — плашка в начале (свой показ). */
export function SeatRibbon({ model, lead }: { model: SeatsModel; lead?: ReactNode }) {
  return (
    <ul className="flex flex-wrap items-center justify-center gap-2" aria-label="Участники">
      {lead && <li>{lead}</li>}
      {model.people.map((p) => (
        <li key={p.identity}>
          <Seat model={model} p={p} layout="chip" />
        </li>
      ))}
    </ul>
  );
}

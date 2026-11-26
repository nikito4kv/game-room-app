import type { ReactNode } from "react";
import { useCurrentFrame } from "remotion";
import { Avatar, type AvatarStatus } from "./Avatar";
import { Icon } from "./Icon";
import { clamp, usePop } from "../fx";

/** Геометрия мест — копия src/components/ui/tableLayout.ts (0° справа, по часовой). */
export function seatAngles(n: number): number[] {
  if (n <= 1) return [-90];
  const start = n === 2 ? 180 : -90 + 180 / n;
  return Array.from({ length: n }, (_, i) => start + (360 / n) * i);
}
const labelAbove = (angleDeg: number) => Math.sin((angleDeg * Math.PI) / 180) < -0.2;
const seatPoint = (angleDeg: number, radius = 40) => {
  const a = (angleDeg * Math.PI) / 180;
  return { left: 50 + radius * Math.cos(a), top: 50 + radius * Math.sin(a) };
};

export type Seat = {
  name: string;
  color: number;
  host?: boolean;
  status?: AvatarStatus | null;
  /** С какого кадра человек «садится» за стол. 0 — сразу. */
  appearAt?: number;
  /** Кто и когда говорит: 0…1 в кадре. */
  speak?: (frame: number) => number;
  /** Громкость 0…1 в кадре. */
  level?: (frame: number) => number;
  seed?: number;
};

function SeatView({
  seat,
  point,
  above,
  avatar,
  labelSize,
  ghost,
}: {
  seat: Seat;
  point: { left: number; top: number };
  above: boolean;
  avatar: number;
  labelSize: number;
  ghost: boolean;
}) {
  const frame = useCurrentFrame();
  const pop = usePop(seat.appearAt ?? 0);
  const shown = (seat.appearAt ?? 0) <= 0 ? 1 : clamp(pop);
  const speak = seat.speak ? seat.speak(frame) : 0;
  const level = seat.level ? seat.level(frame) : 0.7;
  return (
    <div
      style={{
        position: "absolute",
        left: `${point.left}%`,
        top: `${point.top}%`,
        width: avatar,
        height: avatar,
        marginLeft: -avatar / 2,
        marginTop: -avatar / 2,
      }}
    >
      {ghost && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            border: "2px dashed var(--gr-line-control)",
            opacity: 1 - shown,
          }}
        />
      )}
      <div style={{ opacity: shown, transform: `scale(${0.55 + 0.45 * shown})` }}>
        <Avatar
          name={seat.name}
          color={seat.color}
          size={avatar}
          speak={speak}
          level={level}
          status={seat.status}
          seed={seat.seed ?? 0}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: "50%",
          transform: "translateX(-50%)",
          [above ? "bottom" : "top"]: avatar + labelSize * 0.55,
          opacity: shown,
          display: "flex",
          alignItems: "center",
          gap: labelSize * 0.3,
          whiteSpace: "nowrap",
          fontFamily: "var(--gr-font-body)",
          fontWeight: 500,
          fontSize: labelSize,
          lineHeight: 1,
          color: "var(--gr-ink)",
        }}
      >
        {seat.host && (
          <span style={{ color: "var(--gr-crown)", display: "grid" }}>
            <Icon name="crown" size={Math.round(labelSize * 0.95)} sw={2} />
          </span>
        )}
        {seat.name}
      </div>
    </div>
  );
}

/**
 * Круглый стол: люди по кругу, подпись всегда снаружи стола, в центре —
 * состояние комнаты. Эталон — RoundTable в src/app/design/_mocks/room-parts.tsx
 * и TablePreview в src/components/ui.
 */
export function RoundTable({
  size,
  seats,
  center,
  avatarRatio = 0.17,
  ghosts = false,
  lamp = true,
}: {
  size: number;
  seats: Seat[];
  center?: ReactNode;
  /** Диаметр аватара как доля стороны стола. */
  avatarRatio?: number;
  /** Рисовать пунктир на ещё пустых местах. */
  ghosts?: boolean;
  /** Свет лампы над столом. */
  lamp?: boolean;
}) {
  const angles = seatAngles(seats.length);
  const avatar = Math.round(size * avatarRatio);
  const labelSize = Math.round(avatar * 0.2);
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      {lamp && (
        <div
          style={{
            position: "absolute",
            inset: "-12%",
            borderRadius: "50%",
            background: "radial-gradient(closest-side, rgb(255 255 255 / 0.07), transparent)",
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          inset: "26%",
          borderRadius: "50%",
          border: "1px solid var(--gr-line-strong)",
          background: "radial-gradient(closest-side, transparent 62%, var(--gr-wash-2))",
          boxShadow: "inset 0 0 0 6px var(--gr-wash-1)",
        }}
      />
      {center && (
        <div
          style={{
            position: "absolute",
            inset: "29%",
            display: "grid",
            placeItems: "center",
            textAlign: "center",
          }}
        >
          {center}
        </div>
      )}
      {seats.map((s, i) => (
        <SeatView
          key={s.name}
          seat={s}
          point={seatPoint(angles[i])}
          above={labelAbove(angles[i])}
          avatar={avatar}
          labelSize={labelSize}
          ghost={ghosts}
        />
      ))}
    </div>
  );
}

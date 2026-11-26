"use client";

import { memo } from "react";
import type { Participant } from "livekit-client";
import { Avatar, type AvatarSize, type AvatarSurface } from "@/components/ui";
import { RumikAvatar } from "@/components/ui/Avatar";
import type { ToastPerson } from "@/components/ui/Toast";
import { useAvatarPaint } from "../avatar/useAvatarPaint";
import { useRumikTable } from "../participants/ParticipantCircle";

type PersonHeadProps = {
  /** Участник, пока он есть (или только что вышел): тогда голова с его рисунком. */
  p: Participant | null;
  name: string;
  colorIndex: number;
  size: AvatarSize;
  surface?: AvatarSurface;
  className?: string;
};

/**
 * Маленькая голова человека вне места за столом: сообщения чата, тосты, чип
 * показа на сцене. С флагом rumik_table — голова Румика его цвета или белая под
 * его рисунком, как место за столом: у раскрашенного человека связь «место ↔
 * сообщения» держится на картинке, а не только на нике (#546). Ушёл из комнаты —
 * только цвет. Без флага — прежний кружок с инициалами.
 *
 * «Говорит» и уровень голоса здесь не рисуются: голос не перерисовывает ни чат,
 * ни тосты (§7 №5). Рисунок слушает сама голова — новый рисунок будит только её.
 */
export const PersonHead = memo(function PersonHead({ p, ...rest }: PersonHeadProps) {
  const rumik = useRumikTable();
  if (!rumik) return <Avatar {...rest} />;
  return p ? <LiveHead p={p} {...rest} /> : <RumikAvatar {...rest} />;
});

function LiveHead({ p, ...rest }: PersonHeadProps & { p: Participant }) {
  const paint = useAvatarPaint(p);
  return <RumikAvatar {...rest} paint={paint} />;
}

/**
 * Человек для toast(): голова живая — рисунок, пришедший через миг после входа,
 * встаёт в уже показанный тост.
 */
export function toastPerson(p: Participant | null, name: string, colorIndex: number): ToastPerson {
  return {
    name,
    colorIndex,
    head: <PersonHead p={p} name={name} colorIndex={colorIndex} size="sm" surface="overlay" />,
  };
}

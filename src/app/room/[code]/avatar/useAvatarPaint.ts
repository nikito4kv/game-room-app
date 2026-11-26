"use client";

import { useCallback, useSyncExternalStore } from "react";
import { ParticipantEvent, type Participant } from "livekit-client";
import { avatarUrl, parseAvatarAttribute } from "@/lib/api/contract";
import { useMyPaint } from "@/lib/rumik/useMyRumik";
import { useRoomConfig } from "../state/useRoomConfig";
import { useRefusedPaint } from "./refusedPaint";

/**
 * id рисунка участника так, как его видят все: из атрибута avatar.id (его пишет
 * сервер по POST /api/avatar). Перерисовывает только смена атрибутов.
 */
export function useAvatarAttribute(p: Participant): string | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      p.on(ParticipantEvent.AttributesChanged, onChange);
      return () => {
        p.off(ParticipantEvent.AttributesChanged, onChange);
      };
    },
    [p],
  );
  return useSyncExternalStore(
    subscribe,
    () => parseAvatarAttribute(p.attributes),
    () => null,
  );
}

/**
 * Рисунок участника для <Rumik paint={…} />: адрес картинки или null — Румик
 * цвета участника без рисунка. Свой — сразу из браузера (572×480, без ожидания
 * сервера), а если сервер его не принял — то, что видят другие: последний
 * принятый рисунок по атрибуту или Румик своего цвета. Чужой — /api/avatar/<id>
 * из его атрибута. Флаг rumik_share выключен администрацией — у всех null.
 * Звать внутри комнаты (нужна RoomSession).
 */
export function useAvatarPaint(p: Participant): string | null {
  const { flags } = useRoomConfig();
  const mine = useMyPaint();
  const refused = useRefusedPaint();
  const id = useAvatarAttribute(p);
  if (!flags.rumik_share) return null;
  if (p.isLocal && (mine === null || mine !== refused)) return mine;
  return id ? avatarUrl(id) : null;
}

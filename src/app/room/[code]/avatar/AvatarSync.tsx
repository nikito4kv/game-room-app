"use client";

import { useEffect, useReducer, useRef } from "react";
import { useConnectionState, useRoomContext } from "@livekit/components-react";
import { ConnectionState } from "livekit-client";
import { toast } from "@/components/ui/Toast";
import { sendAvatar } from "@/lib/client/api";
import { isApiError } from "@/lib/client/errors";
import { useMyPaint } from "@/lib/rumik/useMyRumik";
import { useRoomConfig } from "../state/useRoomConfig";
import { useRoomSession } from "../state/RoomSession";
import { setRefusedPaint } from "./refusedPaint";
import {
  IDLE_AVATAR_SYNC,
  afterAvatarSync,
  planAvatarSync,
  startAvatarSync,
  type AvatarSync as SyncState,
  type AvatarSyncResult,
} from "./syncPlan";
import { shrinkPaint } from "./shrinkPaint";
import { useAvatarAttribute } from "./useAvatarPaint";

/** Отказы, после которых тот же рисунок слать бесполезно. */
const FINAL = new Set(["AVATAR_BLOCKED", "AVATAR_INVALID", "AVATAR_LIMIT", "BAD_REQUEST"]);

/**
 * Свой рисунок Румика видят другие (R4): пока сидим в комнате, уменьшаем его до
 * 286×240 и шлём на сервер — при входе, при смене рисунка (в соседней вкладке —
 * после затишья) и после входа заново со свежим токеном (атрибута в новой сессии
 * нет). Только когда в комнате включены и рисунки (rumik_share), и стол из
 * Румиков (rumik_table): без стола рисунок никто не увидит. Когда слать, решает
 * planAvatarSync. Сбой — тихо: комната работает и без рисунка, другие видят
 * обычного Румика вашего цвета. Отказ сервера — тоже тихо, кроме «скрыла
 * администрация»: об этом один тост. Ничего не рисует.
 */
export function AvatarSync(): null {
  const room = useRoomContext();
  const { code, token } = useRoomSession();
  const { flags } = useRoomConfig();
  const enabled = flags.rumik_share && flags.rumik_table;
  const connected = useConnectionState(room) === ConnectionState.Connected;
  const paint = useMyPaint();
  const shown = useAvatarAttribute(room.localParticipant);
  const syncRef = useRef<SyncState>(IDLE_AVATAR_SYNC);
  // Ответ пришёл — спросить planAvatarSync заново (рисунок мог смениться, пока ждали).
  const [tick, recheck] = useReducer((n: number) => n + 1, 0);

  // Ушли из комнаты — своё место больше не про отказ.
  useEffect(() => () => setRefusedPaint(null), []);

  useEffect(() => {
    if (!connected || !enabled) return;
    const plan = planAvatarSync(paint, shown, syncRef.current, Date.now());
    syncRef.current = plan.sync;
    if (plan.sendInMs === null) return;
    const png = plan.send;
    const timer = setTimeout(() => {
      syncRef.current = startAvatarSync(syncRef.current, Date.now());
      void send(code, token, png).then((result) => {
        syncRef.current = afterAvatarSync(syncRef.current, result, Date.now());
        setRefusedPaint(syncRef.current.refused);
        recheck();
      });
    }, plan.sendInMs);
    return () => clearTimeout(timer);
  }, [connected, enabled, code, token, paint, shown, tick]);

  return null;
}

async function send(code: string, token: string, paint: string | null): Promise<AvatarSyncResult> {
  try {
    const png = paint === null ? null : await shrinkPaint(paint);
    // Не влез даже огрублённым: другие увидят Румика без рисунка, повторять бесполезно.
    if (paint !== null && png === null) return { ok: false, paint, refused: true };
    const res = await sendAvatar(code, token, png);
    return { ok: true, paint, id: res.id };
  } catch (err) {
    if (isApiError(err) && FINAL.has(err.code)) {
      // Скрытый рисунок — единственный отказ, о котором человеку стоит знать.
      if (err.code === "AVATAR_BLOCKED") toast({ id: "avatar-blocked", tone: "caution", title: err.message });
      return { ok: false, paint, refused: true };
    }
    return { ok: false, retryAfterSec: isApiError(err) ? err.retryAfterSec : undefined };
  }
}

"use client";

import { useCallback, useEffect, useReducer, useRef, useSyncExternalStore } from "react";
import { useConnectionState, useRoomContext } from "@livekit/components-react";
import { ConnectionState, ParticipantEvent, type Participant } from "livekit-client";
import { parseVoiceAttributes, type PublicVoiceState } from "@/lib/api/contract";
import { sendVoiceState } from "@/lib/client/api";
import { isApiError } from "@/lib/client/errors";
import {
  IDLE_VOICE_SYNC,
  afterVoiceSync,
  planVoiceSync,
  type VoiceSync,
  type VoiceSyncResult,
} from "@/lib/room/voicePresence";
import { useRoomSession } from "../state/RoomSession";

const readDeafened = (p: Participant) => parseVoiceAttributes(p.attributes).deafened;
const readPtt = (p: Participant) => parseVoiceAttributes(p.attributes).ptt;

/**
 * «Звук выкл» и рация участника так, как их видят все: из его атрибутов LiveKit
 * (их пишет сервер по POST /api/voice). Перерисовывает только смена атрибутов.
 */
export function useVoiceAttributes(p: Participant): PublicVoiceState {
  const subscribe = useCallback(
    (onChange: () => void) => {
      p.on(ParticipantEvent.AttributesChanged, onChange);
      return () => {
        p.off(ParticipantEvent.AttributesChanged, onChange);
      };
    },
    [p],
  );
  const deafened = useSyncExternalStore(subscribe, () => readDeafened(p), () => false);
  const ptt = useSyncExternalStore(subscribe, () => readPtt(p), () => false);
  return { deafened, ptt };
}

/**
 * Своё «звук выкл» и рацию видят другие (аудит F-С3): шлём их на сервер, он
 * пишет в атрибуты участника — сам клиент свои атрибуты менять не может. Когда
 * слать, решает planVoiceSync: с паузой 300 мс, по одному запросу и сверяясь со
 * своими атрибутами, поэтому после полного переподключения или входа заново
 * (атрибутов в новой сессии нет) состояние уходит снова само. Сбой человеку не
 * показываем: это подсказка друзьям, а не его голос, — просто повторим позже.
 */
export function useVoicePresence({ deafened, ptt }: PublicVoiceState): void {
  const room = useRoomContext();
  const { code, token } = useRoomSession();
  const connected = useConnectionState(room) === ConnectionState.Connected;
  const shown = useVoiceAttributes(room.localParticipant);
  const shownDeafened = shown.deafened;
  const shownPtt = shown.ptt;
  const syncRef = useRef<VoiceSync>(IDLE_VOICE_SYNC);
  // Ответ пришёл — спросить planVoiceSync заново (мог измениться wanted, пока ждали).
  const [tick, recheck] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!connected) return;
    const wanted = { deafened, ptt };
    const plan = planVoiceSync(wanted, { deafened: shownDeafened, ptt: shownPtt }, syncRef.current, Date.now());
    syncRef.current = plan.sync;
    if (plan.sendInMs === null) return;
    const timer = setTimeout(() => {
      syncRef.current = { ...syncRef.current, inFlight: true };
      void sendVoiceState(code, token, wanted)
        .then(
          (): VoiceSyncResult => ({ ok: true, sent: wanted }),
          (err: unknown): VoiceSyncResult => ({
            ok: false,
            retryAfterSec: isApiError(err) ? err.retryAfterSec : undefined,
          }),
        )
        .then((result) => {
          syncRef.current = afterVoiceSync(syncRef.current, result, Date.now());
          recheck();
        });
    }, plan.sendInMs);
    return () => clearTimeout(timer);
  }, [connected, code, token, deafened, ptt, shownDeafened, shownPtt, tick]);
}

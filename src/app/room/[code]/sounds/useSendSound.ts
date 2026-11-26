"use client";

import { useCallback } from "react";
import { toast } from "@/components/ui/Toast";
import { SOUND_BURST, SOUND_WINDOW_MS, type SoundId, type SoundRequest } from "@/lib/api/contract";
import { playBoardSound } from "@/lib/audio/soundboard";
import { ApiError, errorFromResponse, networkError } from "@/lib/client/errors";
import { burstWait, reactionStore } from "../reactions/reactionStore";
import { useLatestRef } from "../state/useLatestRef";
import { useRoomSession } from "../state/RoomSession";

/** Дольше ждать нет смысла: звук к тому времени уже отыграл бы у всех. */
const TIMEOUT_MS = 10_000;

/** POST /api/sound. Отказ — ApiError с готовым текстом. */
export async function postSound(code: string, token: string, sound: SoundId): Promise<void> {
  const body: SoundRequest = { code, token, sound };
  let res: Response;
  try {
    res = await fetch("/api/sound", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw networkError();
  }
  if (res.ok) return;
  const data: unknown = await res.json().catch(() => null);
  throw errorFromResponse(res.status, data, res.headers.get("Retry-After"));
}

// Времена своих отправок — общие для всех кнопок вкладки.
let sent: number[] = [];

/**
 * Сыграть звук всем. Свой звучит сразу (эха сервера не ждём), значок всплывает
 * над своим местом. Чаще SOUND_BURST за 10 с не шлём вовсе — тост «Слишком
 * часто». Сервер отказал — значок убирается, тост говорит почему (отыгравший у
 * себя звук уже не вернуть, но другие его не услышали).
 */
export function useSendSound(): (sound: SoundId) => void {
  const { code, token, identity } = useRoomSession();
  const tokenRef = useLatestRef(token);
  return useCallback(
    (sound: SoundId) => {
      const now = Date.now();
      const wait = burstWait(sent, now, SOUND_BURST, SOUND_WINDOW_MS);
      if (wait > 0) {
        toast({
          id: "sound-limit",
          icon: "info",
          title: `Слишком часто. Подождите ${Math.max(1, Math.ceil(wait / 1000))} с`,
          immediate: true,
        });
        return;
      }
      sent = [...sent.filter((t) => now - t < 60_000), now];
      // Свой звук слышно, даже если звуки других выключены.
      playBoardSound(sound, identity, { mine: true });
      const shown = reactionStore.show(identity, "sound");
      postSound(code, tokenRef.current, sound).catch((err: unknown) => {
        reactionStore.retract(identity, shown);
        const error = err instanceof ApiError ? err : networkError();
        toast({ id: "sound-failed", icon: "info", title: error.message, immediate: true });
      });
    },
    [code, identity, tokenRef],
  );
}

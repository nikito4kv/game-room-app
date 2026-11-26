"use client";

import { useCallback } from "react";
import { toast } from "@/components/ui/Toast";
import type { ReactionKind, ReactionRequest } from "@/lib/api/contract";
import { ApiError, errorFromResponse, networkError } from "@/lib/client/errors";
import { useLatestRef } from "../state/useLatestRef";
import { useRoomSession } from "../state/RoomSession";
import { burstWait, reactionStore } from "./reactionStore";

/** Дольше ждать ответа нет смысла: реакция к тому времени уже ушла бы с экрана. */
const TIMEOUT_MS = 10_000;

/** POST /api/reaction. Отказ — ApiError с готовым текстом. */
export async function postReaction(code: string, token: string, kind: ReactionKind): Promise<void> {
  const body: ReactionRequest = { code, token, kind };
  let res: Response;
  try {
    res = await fetch("/api/reaction", {
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

// Времена своих отправок — общие для всех кнопок вкладки (док, мини-комната).
let sent: number[] = [];

/**
 * Послать реакцию. Своя видна сразу над своим местом, эха сервера не ждём. Чаще
 * REACTION_BURST за 5 с не шлём вовсе — тост «Слишком часто». Сервер отказал —
 * своя реакция убирается, тост говорит почему.
 */
export function useSendReaction(): (kind: ReactionKind) => void {
  const { code, token, identity } = useRoomSession();
  const tokenRef = useLatestRef(token);
  return useCallback(
    (kind: ReactionKind) => {
      const now = Date.now();
      const wait = burstWait(sent, now);
      if (wait > 0) {
        toast({
          id: "reaction-limit",
          icon: "info",
          title: `Слишком часто. Подождите ${Math.max(1, Math.ceil(wait / 1000))} с`,
          immediate: true,
        });
        return;
      }
      sent = [...sent.filter((t) => now - t < 60_000), now];
      const shown = reactionStore.show(identity, kind);
      postReaction(code, tokenRef.current, kind).catch((err: unknown) => {
        reactionStore.retract(identity, shown);
        const error = err instanceof ApiError ? err : networkError();
        toast({ id: "reaction-failed", icon: "info", title: error.message, immediate: true });
      });
    },
    [code, identity, tokenRef],
  );
}

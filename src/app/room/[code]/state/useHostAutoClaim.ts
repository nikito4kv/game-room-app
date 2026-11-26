"use client";

import { useEffect, useState } from "react";
import { useConnectionState, useParticipants } from "@livekit/components-react";
import { ConnectionState } from "livekit-client";
import { isTransientError } from "@/lib/client/errors";
import { pickHostSuccessor } from "@/lib/room/pickHostSuccessor";
import { useRoomSession } from "./RoomSession";
import { useModeration } from "./useModeration";
import { useRoomMeta } from "./useRoomMeta";

/**
 * Прошло ли 5 с после подключения. До этого комната «устаканивается»: metadata
 * и права ещё приходят. Нужен авто-передаче хоста и звукам прав и замка.
 */
export function useHostGrace(): boolean {
  const state = useConnectionState();
  const [graceOver, setGraceOver] = useState(false);
  useEffect(() => {
    if (state !== ConnectionState.Connected) return;
    const t = setTimeout(() => setGraceOver(true), 5000);
    return () => clearTimeout(t);
  }, [state]);
  return graceOver;
}

// Список участников нужен только на вход и выход — не перерисовываемся на каждое
// «кто-то заговорил» (аудит F-М6).
const MEMBERSHIP_ONLY = { updateOnlyOn: [] };

/** Через сколько повторить claim, если сервер не дал место; null — не повторять. */
function retryDelayMs(error: { code: string; retryAfterSec?: number }, transient: boolean): number | null {
  if (error.code === "HOST_HANDOVER_PENDING") return (error.retryAfterSec ?? 5) * 1000 + 300;
  // Сервер ещё не увидел нас в комнате (вход только что) — чуть позже.
  if (error.code === "NOT_IN_ROOM") return 3000;
  if (transient) return 5000;
  return null;
}

/**
 * Авто-передача прав: если хоста нет среди подключённых, все одинаково выбирают
 * преемника (владелец, иначе самый ранний по входу — pickHostSuccessor), и
 * только он просит место (claim). Сервер отдаёт его не раньше чем через 30 с
 * после ухода хоста (вдруг тот просто перезагружает страницу) и отвечает
 * HOST_HANDOVER_PENDING с retryAfterSec — тогда повторяем в назначенное время.
 */
export function useHostAutoClaim(graceOver: boolean): void {
  const state = useConnectionState();
  const participants = useParticipants(MEMBERSHIP_ONLY);
  const { hostIdentity, ownerIdentity } = useRoomMeta();
  const { identity } = useRoomSession();
  const { moderate } = useModeration();
  const [retryTick, setRetryTick] = useState(0);

  const hostAbsent = hostIdentity === null || !participants.some((p) => p.identity === hostIdentity);
  const successor = hostAbsent ? pickHostSuccessor(participants, ownerIdentity) : null;
  const shouldClaim =
    state === ConnectionState.Connected &&
    graceOver &&
    hostAbsent &&
    !!successor &&
    successor.identity === identity;

  useEffect(() => {
    if (!shouldClaim) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void moderate({ action: "claim" }, { silent: true }).then((result) => {
      if (cancelled || result.ok) return;
      const delay = retryDelayMs(result.error, isTransientError(result.error));
      if (delay !== null) timer = setTimeout(() => setRetryTick((n) => n + 1), delay);
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [shouldClaim, moderate, retryTick]);
}

"use client";

import { useCallback } from "react";
import { toast } from "@/components/ui/Toast";
import type { GameCommand, GameRequest } from "@/lib/api/contract";
import { ApiError, errorFromResponse, networkError } from "@/lib/client/errors";
import { useLatestRef } from "../state/useLatestRef";
import { useRoomSession } from "../state/RoomSession";

const TIMEOUT_MS = 10_000;

/** POST /api/game. Отказ — ApiError с готовым текстом. */
export async function postGame(code: string, token: string, command: GameCommand): Promise<void> {
  const body: GameRequest = { code, token, ...command };
  let res: Response;
  try {
    res = await fetch("/api/game", {
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

/**
 * Игра для всех. Итог придёт data-пакетом всем, включая вас (useGameFeed), —
 * здесь только запрос; отказ сервера (часто, выключено) — тостом.
 */
export function useSendGame(): (command: GameCommand) => void {
  const { code, token } = useRoomSession();
  const tokenRef = useLatestRef(token);
  return useCallback(
    (command: GameCommand) => {
      postGame(code, tokenRef.current, command).catch((err: unknown) => {
        const error = err instanceof ApiError ? err : networkError();
        toast({ id: "game-failed", icon: "info", title: error.message, immediate: true });
      });
    },
    [code, tokenRef],
  );
}

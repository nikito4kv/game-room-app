"use client";

import { useEffect, useState } from "react";
import { useRoomContext } from "@livekit/components-react";
import { rttFromStats } from "@/lib/room/ping";

/** Как часто спрашивать пинг, пока вкладка видна. */
const POLL_MS = 5000;

/**
 * Пинг до сервера, мс. Реальный RTT берём из статистики WebRTC; путь
 * room.engine.* помечен @internal, поэтому строго через optional-chaining и
 * try/catch — недоступен → null (остаётся оценка качества LiveKit).
 * Опрос идёт только пока вкладка видна: в игре его никто не видит (аудит F).
 */
export function useRttMs(): number | null {
  const room = useRoomContext();
  const [rtt, setRtt] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const poll = async () => {
      try {
        const eng = (
          room as unknown as {
            engine?: {
              pcManager?: { publisher?: { getPC?: () => RTCPeerConnection; pc?: RTCPeerConnection } };
            };
          }
        ).engine;
        const pub = eng?.pcManager?.publisher;
        const pc = pub?.getPC?.() ?? pub?.pc;
        const stats = await pc?.getStats?.();
        if (!stats || !alive) return;
        const ms = rttFromStats(stats);
        if (alive && ms !== null) setRtt(ms);
      } catch {
        // @internal-путь недоступен — тихо остаёмся на оценке качества
      }
    };
    const start = () => {
      if (timer) return;
      void poll();
      timer = setInterval(poll, POLL_MS);
    };
    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [room]);
  return rtt;
}

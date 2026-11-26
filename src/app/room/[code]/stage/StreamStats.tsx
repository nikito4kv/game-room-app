"use client";

import { useEffect, useState } from "react";
import type { RemoteVideoTrack } from "livekit-client";
import { streamStatsView, type ReceiverSample, type StreamStatsView } from "@/lib/room/streamStats";

/** Раз в секунду, пока поповер открыт: в покое статистику никто не спрашивает. */
const POLL_MS = 1000;

/**
 * Что реально приходит к вам: разрешение, кадры, битрейт, кодек, потери — по
 * getStats приёмника. Сразу видно, какой слой пришёл (аудит C-1) и тянет ли
 * видеокарта декодирование. Монтируется только при открытом поповере «i».
 */
export default function StreamStats({ track }: { track: RemoteVideoTrack | undefined }) {
  const [view, setView] = useState<StreamStatsView | null>(null);

  useEffect(() => {
    if (!track) return;
    let alive = true;
    let prev: ReceiverSample | undefined;
    const poll = async () => {
      const s = await track.getReceiverStats();
      if (!alive || !s) return;
      const sample: ReceiverSample = {
        timestamp: s.timestamp,
        frameWidth: s.frameWidth,
        frameHeight: s.frameHeight,
        framesDecoded: s.framesDecoded,
        bytesReceived: s.bytesReceived,
        packetsReceived: s.packetsReceived,
        packetsLost: s.packetsLost,
        mimeType: s.mimeType,
        decoderImplementation: s.decoderImplementation,
      };
      setView(streamStatsView(prev, sample));
      prev = sample;
    };
    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [track]);

  const rows: [string, string | null][] = [
    ["Разрешение", view?.resolution ?? null],
    ["Кадров", view?.fps ?? null],
    ["Скорость", view?.bitrate ?? null],
    ["Кодек", view?.codec ?? null],
    ["Потери", view?.loss ?? null],
  ];
  return (
    <div>
      <p className="mb-2 text-label font-semibold text-ink">Что приходит к вам</p>
      <dl
        data-testid="stream-stats"
        data-resolution={view?.resolution ?? ""}
        className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-label"
      >
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-3">{k}</dt>
            <dd className="text-right font-code tabular-nums text-ink">{v ?? "…"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

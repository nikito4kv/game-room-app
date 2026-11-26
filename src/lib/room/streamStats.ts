// Статистика принятого потока демонстрации для поповера «i» на сцене: что
// реально приходит к зрителю — разрешение, кадры, битрейт, кодек, потери.
// Считается по двум соседним замерам getStats приёмника (раз в секунду, только
// пока поповер открыт).

/** Нужные поля inbound-rtp (VideoReceiverStats из livekit-client). */
export type ReceiverSample = {
  /** Время замера, мс. */
  timestamp: number;
  frameWidth?: number;
  frameHeight?: number;
  framesDecoded?: number;
  bytesReceived?: number;
  packetsReceived?: number;
  packetsLost?: number;
  mimeType?: string;
  decoderImplementation?: string;
};

export type StreamStatsView = {
  /** «1920×1080». */
  resolution: string | null;
  /** «60 к/с». */
  fps: string | null;
  /** «6,1 Мбит/с». */
  bitrate: string | null;
  /** «H.264 · аппаратно». */
  codec: string | null;
  /** «0,2%». */
  loss: string | null;
};

const comma = (v: number, digits: number) => v.toFixed(digits).replace(".", ",");

const CODEC_NAMES: Record<string, string> = {
  h264: "H.264",
  vp8: "VP8",
  vp9: "VP9",
  av1: "AV1",
  h265: "H.265",
};

/**
 * Программные декодеры Chrome; всё остальное (D3D11, ExternalDecoder,
 * VideoToolbox…) — видеокарта. Имя декодера браузер открывает только странице с
 * доступом к микрофону или камере — у нас он есть.
 */
const SOFTWARE_DECODERS = /libvpx|ffmpeg|openh264|dav1d|libaom|libgav1/i;

/** «H.264 · аппаратно» из mimeType («video/H264») и имени декодера. */
export function codecLabel(mimeType?: string, decoder?: string): string | null {
  const raw = mimeType?.split("/")[1]?.toLowerCase();
  if (!raw) return null;
  const name = CODEC_NAMES[raw] ?? raw.toUpperCase();
  if (!decoder) return name;
  return `${name} · ${SOFTWARE_DECODERS.test(decoder) ? "программно" : "аппаратно"}`;
}

/** Строки для поповера из двух замеров: prev — секунду назад (или нет). */
export function streamStatsView(prev: ReceiverSample | undefined, next: ReceiverSample): StreamStatsView {
  const resolution =
    next.frameWidth && next.frameHeight ? `${next.frameWidth}×${next.frameHeight}` : null;
  const codec = codecLabel(next.mimeType, next.decoderImplementation);
  const dt = prev ? (next.timestamp - prev.timestamp) / 1000 : 0;
  if (!prev || dt <= 0) return { resolution, fps: null, bitrate: null, codec, loss: null };

  const delta = (key: "framesDecoded" | "bytesReceived" | "packetsReceived" | "packetsLost") =>
    next[key] !== undefined && prev[key] !== undefined ? Math.max(0, next[key] - prev[key]) : null;

  const frames = delta("framesDecoded");
  const bytes = delta("bytesReceived");
  const received = delta("packetsReceived");
  const lost = delta("packetsLost");

  const fps = frames === null ? null : `${Math.round(frames / dt)} к/с`;
  const mbps = bytes === null ? null : (bytes * 8) / dt / 1_000_000;
  const bitrate = mbps === null ? null : mbps >= 10 ? `${Math.round(mbps)} Мбит/с` : `${comma(mbps, 1)} Мбит/с`;
  const total = (received ?? 0) + (lost ?? 0);
  const loss = received === null || lost === null ? null : total === 0 ? "0%" : `${comma((lost / total) * 100, 1)}%`;
  return { resolution, fps, bitrate, codec, loss };
}

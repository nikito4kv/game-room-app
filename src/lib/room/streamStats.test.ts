import { describe, expect, it } from "vitest";
import { codecLabel, streamStatsView } from "./streamStats";

describe("codecLabel", () => {
  it("имя кодека и чем декодирует", () => {
    expect(codecLabel("video/H264", "ExternalDecoder")).toBe("H.264 · аппаратно");
    expect(codecLabel("video/VP8", "libvpx")).toBe("VP8 · программно");
    expect(codecLabel("video/H264", "FFmpeg")).toBe("H.264 · программно");
    expect(codecLabel("video/VP8")).toBe("VP8");
  });

  it("нет кодека — нет строки", () => {
    expect(codecLabel(undefined, "libvpx")).toBeNull();
  });
});

describe("streamStatsView", () => {
  const first = {
    timestamp: 1000,
    frameWidth: 1920,
    frameHeight: 1080,
    framesDecoded: 600,
    bytesReceived: 5_000_000,
    packetsReceived: 10_000,
    packetsLost: 10,
    mimeType: "video/H264",
    decoderImplementation: "D3D11VideoDecoder",
  };

  it("первый замер — только разрешение и кодек", () => {
    expect(streamStatsView(undefined, first)).toEqual({
      resolution: "1920×1080",
      fps: null,
      bitrate: null,
      codec: "H.264 · аппаратно",
      loss: null,
    });
  });

  it("второй замер — кадры, битрейт и потери за секунду", () => {
    const next = {
      ...first,
      timestamp: 2000,
      framesDecoded: 660,
      bytesReceived: 5_000_000 + 762_500,
      packetsReceived: 10_998,
      packetsLost: 12,
    };
    expect(streamStatsView(first, next)).toEqual({
      resolution: "1920×1080",
      fps: "60 к/с",
      bitrate: "6,1 Мбит/с",
      codec: "H.264 · аппаратно",
      loss: "0,2%",
    });
  });

  it("большой поток — без дробей, тишина — 0%", () => {
    const next = { ...first, timestamp: 2000, bytesReceived: 5_000_000 + 1_500_000, packetsReceived: 10_000, packetsLost: 10 };
    const view = streamStatsView(first, next);
    expect(view.bitrate).toBe("12 Мбит/с");
    expect(view.loss).toBe("0%");
  });
});

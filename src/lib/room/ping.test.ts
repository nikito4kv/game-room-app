import { describe, expect, it } from "vitest";
import { isPoorLink, linkHint, linkQuality, rttFromStats, rttQuality } from "./ping";

const stats = (...entries: object[]) => new Map(entries.map((e, i) => [String(i), e]));

describe("rttFromStats", () => {
  it("берёт RTT выбранной ICE-пары в миллисекундах", () => {
    const s = stats(
      { type: "inbound-rtp" },
      { type: "candidate-pair", nominated: false, currentRoundTripTime: 0.5 },
      { type: "candidate-pair", nominated: true, currentRoundTripTime: 0.0237 },
    );
    expect(rttFromStats(s)).toBe(24);
  });

  it("нет выбранной пары или RTT → null", () => {
    expect(rttFromStats(stats())).toBeNull();
    expect(rttFromStats(stats({ type: "candidate-pair", nominated: true }))).toBeNull();
  });
});

describe("rttQuality", () => {
  it("пороги 60 и 150 мс", () => {
    expect(rttQuality(42)).toBe("excellent");
    expect(rttQuality(60)).toBe("good");
    expect(rttQuality(149)).toBe("good");
    expect(rttQuality(182)).toBe("poor");
  });
});

describe("linkQuality", () => {
  it("худшее из пинга и оценки LiveKit", () => {
    expect(linkQuality(30, "poor")).toBe("poor");
    expect(linkQuality(182, "excellent")).toBe("poor");
    expect(linkQuality(30, "excellent")).toBe("excellent");
    expect(linkQuality(30, "lost")).toBe("lost");
  });

  it("чего не знаем — берём что есть", () => {
    expect(linkQuality(null, "good")).toBe("good");
    expect(linkQuality(90, "unknown")).toBe("good");
    expect(linkQuality(null, "unknown")).toBe("unknown");
  });
});

describe("isPoorLink", () => {
  it("слабая и потерянная — да, остальное — нет", () => {
    expect(isPoorLink("poor")).toBe(true);
    expect(isPoorLink("lost")).toBe(true);
    expect(isPoorLink("good")).toBe(false);
    expect(isPoorLink("unknown")).toBe(false);
  });
});

describe("linkHint", () => {
  it("качество словами и пинг", () => {
    expect(linkHint("excellent", 42)).toBe("Связь с сервером: отличная, 42 мс");
    expect(linkHint("unknown", null)).toBe("Связь с сервером: проверяем");
    expect(linkHint("lost", 900)).toBe("Связь с сервером потеряна");
  });
});

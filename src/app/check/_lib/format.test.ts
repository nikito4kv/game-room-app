import { describe, expect, it } from "vitest";
import { formatBytes, formatMoment, formatMs, formatSpeed, speedBytesPerSecond } from "./format";

describe("formatBytes", () => {
  it("байты, килобайты, мегабайты", () => {
    expect(formatBytes(0)).toBe("0 Б");
    expect(formatBytes(300)).toBe("300 Б");
    expect(formatBytes(16 * 1024)).toBe("16 КБ");
    expect(formatBytes(300 * 1024)).toBe("300 КБ");
    expect(formatBytes(1024 * 1024)).toBe("1 МБ");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1,5 МБ");
  });
  it("не показывает отрицательные", () => {
    expect(formatBytes(-5)).toBe("0 Б");
  });
});

describe("formatMs", () => {
  it("миллисекунды и секунды с запятой", () => {
    expect(formatMs(142)).toBe("142 мс");
    expect(formatMs(999)).toBe("999 мс");
    expect(formatMs(1234)).toBe("1,2 с");
    expect(formatMs(5000)).toBe("5 с");
    expect(formatMs(12000)).toBe("12 с");
  });
});

describe("formatSpeed", () => {
  it("КБ/с и МБ/с", () => {
    expect(formatSpeed(300 * 1024, 3000)).toBe("100 КБ/с");
    expect(formatSpeed(2 * 1024 * 1024, 1000)).toBe("2,0 МБ/с");
  });
  it("нечего делить: null", () => {
    expect(formatSpeed(0, 1000)).toBeNull();
    expect(formatSpeed(1000, 0)).toBeNull();
    expect(speedBytesPerSecond(1000, -1)).toBeNull();
  });
});

describe("formatMoment", () => {
  const at = new Date(Date.UTC(2026, 9, 1, 11, 35, 12));
  it("Москва: UTC+03:00", () => {
    expect(formatMoment(at, -180, "Europe/Moscow")).toBe("2026-10-01 14:35:12 (UTC+03:00, Europe/Moscow)");
  });
  it("перешагивает через полночь", () => {
    const late = new Date(Date.UTC(2026, 9, 1, 22, 5, 0));
    expect(formatMoment(late, -180, "Europe/Moscow")).toBe("2026-10-02 01:05:00 (UTC+03:00, Europe/Moscow)");
  });
  it("запад от Гринвича и пояс с половиной часа", () => {
    expect(formatMoment(at, 300, "America/New_York")).toBe("2026-10-01 06:35:12 (UTC-05:00, America/New_York)");
    expect(formatMoment(at, -330, "Asia/Kolkata")).toBe("2026-10-01 17:05:12 (UTC+05:30, Asia/Kolkata)");
  });
  it("без названия пояса пишет только смещение", () => {
    expect(formatMoment(at, 0, "")).toBe("2026-10-01 11:35:12 (UTC+00:00)");
  });
});

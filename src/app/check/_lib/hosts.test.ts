import { describe, expect, it } from "vitest";
import { parseVoiceUrl, resolveTurnHost } from "./hosts";

describe("parseVoiceUrl", () => {
  it("wss-адрес: имя, HTTPS-origin и путь сигналинга клиента LiveKit", () => {
    expect(parseVoiceUrl("wss://rtc.game-room.space")).toEqual({
      url: "wss://rtc.game-room.space",
      host: "rtc.game-room.space",
      hostname: "rtc.game-room.space",
      httpOrigin: "https://rtc.game-room.space",
      wsUrl: "wss://rtc.game-room.space/rtc",
    });
  });

  it("порт сохраняется, путь отбрасывается; ws:// остаётся без TLS", () => {
    const p = parseVoiceUrl("ws://localhost:7880/some/path?x=1");
    expect(p?.host).toBe("localhost:7880");
    expect(p?.hostname).toBe("localhost");
    expect(p?.httpOrigin).toBe("http://localhost:7880");
    expect(p?.wsUrl).toBe("ws://localhost:7880/rtc");
  });

  it("https:// тоже принимаем (так иногда пишут адрес)", () => {
    expect(parseVoiceUrl("https://rtc.example.com")?.url).toBe("wss://rtc.example.com");
  });

  it("пусто, мусор и чужие схемы: null", () => {
    expect(parseVoiceUrl(null)).toBeNull();
    expect(parseVoiceUrl("")).toBeNull();
    expect(parseVoiceUrl("не адрес")).toBeNull();
    expect(parseVoiceUrl("ftp://rtc.example.com")).toBeNull();
  });
});

describe("resolveTurnHost", () => {
  it("rtc.<домен> даёт turn.<домен>", () => {
    expect(resolveTurnHost("rtc.game-room.space")).toBe("turn.game-room.space");
    expect(resolveTurnHost("RTC.Example.COM")).toBe("turn.example.com");
  });

  it("явная настройка главнее и чистится", () => {
    expect(resolveTurnHost("rtc.game-room.space", " TURN.other.example ")).toBe("turn.other.example");
  });

  it("битая настройка игнорируется, дальше работает правило rtc.→turn.", () => {
    expect(resolveTurnHost("rtc.game-room.space", "https://bad host/")).toBe("turn.game-room.space");
  });

  it("не rtc.-имя и числовые адреса: null (имени для TURN нет)", () => {
    expect(resolveTurnHost("voice.example.com")).toBeNull();
    expect(resolveTurnHost("localhost")).toBeNull();
    expect(resolveTurnHost("127.0.0.1")).toBeNull();
    expect(resolveTurnHost(null)).toBeNull();
    expect(resolveTurnHost("rtc.")).toBeNull();
  });
});

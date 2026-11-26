import { describe, expect, it } from "vitest";
import { buildPageBeacon, externalReferrer, newVid, shouldTrackPath } from "./beacon";

describe("маяк страниц", () => {
  it("не считает /design", () => {
    expect(shouldTrackPath("/design")).toBe(false);
    expect(shouldTrackPath("/design/room")).toBe(false);
    expect(shouldTrackPath("/designer")).toBe(true);
    expect(shouldTrackPath("/room/ABC123")).toBe(true);
  });

  it("источник — только внешний, без query", () => {
    expect(externalReferrer("https://game-room.space/pricing", "game-room.space")).toBeUndefined();
    expect(externalReferrer("https://vk.com/wall-1?w=secret", "game-room.space")).toBe("https://vk.com/wall-1");
    expect(externalReferrer("https://t.me/", "game-room.space")).toBe("https://t.me");
    expect(externalReferrer("", "x")).toBeUndefined();
    expect(externalReferrer("android-app://org.telegram", "x")).toBeUndefined();
    expect(externalReferrer("не адрес", "x")).toBeUndefined();
  });

  it("собирает путь, utm и vid; пустые метки не шлёт", () => {
    expect(
      buildPageBeacon({
        path: "/clubs",
        search: "?utm_source=vk&utm_medium=&utm_campaign=club%20pilot&t=secret",
        referrer: "https://vk.com/",
        host: "game-room.space",
        vid: "abcdefghijklmnopqrstuv",
      }),
    ).toEqual({
      path: "/clubs",
      ref: "https://vk.com",
      utm_source: "vk",
      utm_campaign: "club pilot",
      vid: "abcdefghijklmnopqrstuv",
    });
    expect(buildPageBeacon({ path: "", search: "", referrer: "", host: "h", vid: null })).toEqual({ path: "/" });
  });

  it("vid — 22 символа base64url и каждый раз новый", () => {
    const a = newVid();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(newVid()).not.toBe(a);
  });
});

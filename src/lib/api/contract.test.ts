import { describe, expect, it } from "vitest";
import { parseParticipantPublicMeta, parseRoomPublicMeta, type RoomPublicMeta } from "./contract";

const v2: RoomPublicMeta = {
  v: 2,
  title: "Игра",
  isPublic: true,
  createdAt: 123,
  hostIdentity: "u_host",
  hostName: "Аня",
  ownerIdentity: "u_host",
  locked: true,
  hasPassword: true,
  settings: { screen: "approved", chat: "host" },
};

describe("parseRoomPublicMeta", () => {
  it("разбирает схему v2 без потерь", () => {
    expect(parseRoomPublicMeta(JSON.stringify(v2))).toEqual(v2);
  });

  it("прежняя схема: хост — ник, настройки по умолчанию", () => {
    const old = { title: "Игра", isPublic: false, hostIdentity: "Вася", createdAt: 5, locked: true };
    expect(parseRoomPublicMeta(JSON.stringify(old))).toEqual({
      v: 2,
      title: "Игра",
      isPublic: false,
      createdAt: 5,
      hostIdentity: "Вася",
      hostName: "Вася",
      ownerIdentity: null,
      locked: true,
      hasPassword: false,
      settings: { screen: "all", chat: "all" },
    });
  });

  it("хоста нет — null, неизвестные режимы — по умолчанию", () => {
    const m = parseRoomPublicMeta(
      JSON.stringify({ ...v2, hostIdentity: null, hostName: null, settings: { screen: "x", chat: 1 } }),
    );
    expect(m?.hostIdentity).toBeNull();
    expect(m?.hostName).toBeNull();
    expect(m?.settings).toEqual({ screen: "all", chat: "all" });
  });

  it("битое и неполное — null", () => {
    expect(parseRoomPublicMeta(undefined)).toBeNull();
    expect(parseRoomPublicMeta("")).toBeNull();
    expect(parseRoomPublicMeta("{нет")).toBeNull();
    expect(parseRoomPublicMeta("[]")).toBeNull();
    expect(parseRoomPublicMeta(JSON.stringify({ ...v2, title: "" }))).toBeNull();
    expect(parseRoomPublicMeta(JSON.stringify({ ...v2, isPublic: "да" }))).toBeNull();
    expect(parseRoomPublicMeta(JSON.stringify({ ...v2, createdAt: "1" }))).toBeNull();
  });
});

describe("parseParticipantPublicMeta", () => {
  it("флаги и причина удаления", () => {
    expect(
      parseParticipantPublicMeta(
        JSON.stringify({ forceMuted: true, chatMuted: false, screenAllowed: true, removed: { reason: "kick", retryAfterSec: 300 } }),
      ),
    ).toEqual({ forceMuted: true, chatMuted: false, screenAllowed: true, removed: { reason: "kick", retryAfterSec: 300 } });
  });

  it("пусто или мусор — всё false, неизвестная причина отбрасывается", () => {
    const none = { forceMuted: false, chatMuted: false, screenAllowed: false };
    expect(parseParticipantPublicMeta("")).toEqual(none);
    expect(parseParticipantPublicMeta("{x")).toEqual(none);
    expect(parseParticipantPublicMeta(JSON.stringify({ removed: { reason: "hack" } }))).toEqual(none);
    expect(parseParticipantPublicMeta(JSON.stringify({ forceMuted: "yes" }))).toEqual(none);
  });
});

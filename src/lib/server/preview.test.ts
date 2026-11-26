import { describe, expect, it } from "vitest";
import { DEFAULT_ROOM_SETTINGS } from "@/lib/api/contract";
import type { StoredRoomMeta } from "@/lib/roomSecret";
import { buildPreview } from "./preview";

const meta: StoredRoomMeta = {
  title: "Вечерняя катка",
  isPublic: true,
  createdAt: 1,
  hostIdentity: "u_host",
  hostName: "Хост",
  ownerIdentity: "u_host",
  locked: true,
  hasPassword: false,
  settings: DEFAULT_ROOM_SETTINGS,
  badge: null,
  keyId: null,
  maxParticipants: null,
  rev: 3,
};
const people = [
  { identity: "u_b", name: "Боря", joinedAt: 30n },
  { identity: "u_host", name: "Хост", joinedAt: 20n },
  { identity: "u_a", name: "Аня", joinedAt: 10n },
];
const liveRoom = { numParticipants: 3, maxParticipants: 10 };

describe("buildPreview", () => {
  it("описание и состав: хост первым, остальные по времени входа", () => {
    expect(buildPreview({ code: "ABC123", meta, liveRoom, participants: people })).toEqual({
      code: "ABC123",
      title: "Вечерняя катка",
      hasPassword: false,
      locked: true,
      isPublic: true,
      participantCount: 3,
      maxParticipants: 10,
      participants: [
        { name: "Хост", isHost: true },
        { name: "Аня", isHost: false },
        { name: "Боря", isHost: false },
      ],
    });
  });

  it("с паролем — только количество, без имён", () => {
    const p = buildPreview({ code: "ABC123", meta: { ...meta, hasPassword: true }, liveRoom, participants: people });
    expect(p.participantCount).toBe(3);
    expect(p).not.toHaveProperty("participants");
  });

  it("LiveKit не дал состав — без имён, счётчик из комнаты", () => {
    const p = buildPreview({ code: "ABC123", meta, liveRoom: { numParticipants: 2, maxParticipants: 6 }, participants: null });
    expect(p).toMatchObject({ participantCount: 2, maxParticipants: 6 });
    expect(p).not.toHaveProperty("participants");
  });

  it("LiveKit не ответил вовсе — 0 и лимит по умолчанию", () => {
    const p = buildPreview({ code: "ABC123", meta, liveRoom: null, participants: null });
    expect(p).toMatchObject({ participantCount: 0, maxParticipants: 10 });
  });

  it("комнаты нет в LiveKit (потерял) — внутри никого", () => {
    expect(buildPreview({ code: "ABC123", meta, liveRoom: null, participants: [] })).toMatchObject({
      participantCount: 0,
      participants: [],
    });
  });

  it("пустой ник не светит identity", () => {
    const p = buildPreview({ code: "ABC123", meta, liveRoom, participants: [{ identity: "u_x", name: "" }] });
    expect(p.participants).toEqual([{ name: "Участник", isHost: false }]);
  });
});

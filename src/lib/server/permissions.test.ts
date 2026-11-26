import { describe, expect, it } from "vitest";
import { TrackSource } from "livekit-server-sdk";
import type { RoomSettings } from "@/lib/api/contract";
import {
  canShareScreen,
  participantMetaFor,
  permissionFor,
  permissionWithoutScreen,
  samePermission,
  type ParticipantState,
} from "./permissions";

const { MICROPHONE: MIC, SCREEN_SHARE: SCREEN, SCREEN_SHARE_AUDIO: SCREEN_AUDIO, CAMERA } = TrackSource;
const ALL: RoomSettings = { screen: "all", chat: "all" };
const guest: ParticipantState = {
  isHost: false,
  forceMuted: false,
  chatMuted: false,
  screenAllowed: false,
};
const host: ParticipantState = { ...guest, isHost: true };

describe("permissionFor", () => {
  it("обычный участник: микрофон, экран и звук экрана; без камеры и своих data-пакетов", () => {
    const p = permissionFor(ALL, guest);
    expect(p.canPublish).toBe(true);
    expect(p.canPublishSources).toEqual([MIC, SCREEN, SCREEN_AUDIO]);
    expect(p.canPublishSources).not.toContain(CAMERA);
    expect(p.canPublishData).toBe(false);
    expect(p.canSubscribe).toBe(true);
    expect(p.canUpdateMetadata).toBe(false);
  });

  it("всегда полный набор полей (updateParticipant считает пропущенные выключенными)", () => {
    expect(Object.keys(permissionFor(ALL, guest)).sort()).toEqual(
      [
        "agent",
        "canManageAgentSession",
        "canPublish",
        "canPublishData",
        "canPublishSources",
        "canSubscribe",
        "canSubscribeMetrics",
        "canUpdateMetadata",
        "hidden",
        "recorder",
      ].sort(),
    );
  });

  it("принудительный мьют закрывает и микрофон, и звук демонстрации", () => {
    const p = permissionFor(ALL, { ...guest, forceMuted: true });
    expect(p.canPublishSources).toEqual([SCREEN]);
    expect(p.canPublish).toBe(true);
  });

  it("ловушка №1: ни одного источника → canPublish: false, а не пустой список", () => {
    const p = permissionFor({ screen: "host", chat: "all" }, { ...guest, forceMuted: true });
    expect(p.canPublishSources).toEqual([]);
    expect(p.canPublish).toBe(false);
  });

  it("экран «только хост»: гостю нельзя, хосту можно", () => {
    const s: RoomSettings = { screen: "host", chat: "all" };
    expect(permissionFor(s, guest).canPublishSources).toEqual([MIC]);
    expect(permissionFor(s, host).canPublishSources).toEqual([MIC, SCREEN, SCREEN_AUDIO]);
  });

  it("экран «по разрешению»: только хосту и разрешённым", () => {
    const s: RoomSettings = { screen: "approved", chat: "all" };
    expect(permissionFor(s, guest).canPublishSources).toEqual([MIC]);
    expect(permissionFor(s, { ...guest, screenAllowed: true }).canPublishSources).toEqual([
      MIC,
      SCREEN,
      SCREEN_AUDIO,
    ]);
  });

  it("хоста не мьютят, даже если флаг остался", () => {
    expect(permissionFor(ALL, { ...host, forceMuted: true }).canPublishSources).toEqual([
      MIC,
      SCREEN,
      SCREEN_AUDIO,
    ]);
  });

  it("своих data-пакетов нет ни у кого, даже у хоста", () => {
    expect(permissionFor(ALL, host).canPublishData).toBe(false);
  });

  it("запрет чата на права не влияет — его принуждает POST /api/chat", () => {
    expect(permissionFor(ALL, { ...guest, chatMuted: true })).toEqual(permissionFor(ALL, guest));
  });
});

describe("canShareScreen", () => {
  it("все режимы", () => {
    expect(canShareScreen("all", guest)).toBe(true);
    expect(canShareScreen("host", guest)).toBe(false);
    expect(canShareScreen("approved", guest)).toBe(false);
    expect(canShareScreen("approved", { ...guest, screenAllowed: true })).toBe(true);
    expect(canShareScreen("host", host)).toBe(true);
  });
});

describe("permissionWithoutScreen", () => {
  it("убирает только экран", () => {
    expect(permissionWithoutScreen(ALL, guest).canPublishSources).toEqual([MIC]);
  });
  it("если без экрана ничего не остаётся — публикация выключена", () => {
    const p = permissionWithoutScreen(ALL, { ...guest, forceMuted: true });
    expect(p.canPublish).toBe(false);
  });
});

describe("participantMetaFor", () => {
  it("флаги для интерфейса; у хоста мьюта и запрета чата не бывает", () => {
    expect(participantMetaFor({ ...guest, forceMuted: true, chatMuted: true })).toEqual({
      forceMuted: true,
      chatMuted: true,
      screenAllowed: false,
    });
    expect(participantMetaFor({ ...host, forceMuted: true, chatMuted: true })).toEqual({
      forceMuted: false,
      chatMuted: false,
      screenAllowed: false,
    });
  });
});

describe("samePermission", () => {
  it("порядок источников не важен, отличие в любом поле — важно", () => {
    const next = permissionFor(ALL, guest);
    expect(samePermission({ ...next, canPublishSources: [SCREEN_AUDIO, MIC, SCREEN] }, next)).toBe(true);
    expect(samePermission({ ...next, canPublishData: true }, next)).toBe(false);
    expect(samePermission({ ...next, canPublishSources: [MIC] }, next)).toBe(false);
    expect(samePermission(undefined, next)).toBe(false);
  });
});

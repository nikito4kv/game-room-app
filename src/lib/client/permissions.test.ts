import { describe, expect, it } from "vitest";
import { PROTO_SOURCE, canPublishSource, chatBlockReason, myAbilities } from "./permissions";

const ALL = { screen: "all", chat: "all" } as const;

describe("canPublishSource", () => {
  it("как в LiveKit: пустой список — можно всё, без canPublish — ничего", () => {
    expect(canPublishSource({ canPublish: true, canPublishSources: [] }, PROTO_SOURCE.SCREEN_SHARE)).toBe(true);
    expect(canPublishSource({ canPublish: false, canPublishSources: [] }, PROTO_SOURCE.MICROPHONE)).toBe(false);
    expect(canPublishSource(undefined, PROTO_SOURCE.MICROPHONE)).toBe(false);
  });

  it("смотрит на конкретный источник", () => {
    const perms = { canPublish: true, canPublishSources: [PROTO_SOURCE.MICROPHONE] };
    expect(canPublishSource(perms, PROTO_SOURCE.MICROPHONE)).toBe(true);
    expect(canPublishSource(perms, PROTO_SOURCE.SCREEN_SHARE)).toBe(false);
  });
});

describe("myAbilities", () => {
  it("экран только хосту — у гостя кнопка с причиной", () => {
    const a = myAbilities({
      permissions: { canPublish: true, canPublishSources: [PROTO_SOURCE.MICROPHONE] },
      settings: { screen: "host", chat: "all" },
      amHost: false,
      meta: { chatMuted: false },
    });
    expect(a).toMatchObject({
      canSpeak: true,
      canShareScreen: false,
      screenHint: "Показывать экран сейчас может только хост",
      canChat: true,
      chatHint: null,
    });
  });

  it("принудительный мьют: экран можно, но без звука", () => {
    const a = myAbilities({
      permissions: { canPublish: true, canPublishSources: [PROTO_SOURCE.SCREEN_SHARE] },
      settings: ALL,
      amHost: false,
      meta: { chatMuted: false },
    });
    expect(a).toMatchObject({ canSpeak: false, canShareScreen: true, canShareScreenAudio: false, screenHint: null });
  });

  it("до подключения подсказки про экран нет", () => {
    expect(myAbilities({ permissions: undefined, settings: ALL, amHost: false, meta: { chatMuted: false } }).screenHint).toBeNull();
  });
});

describe("chatBlockReason", () => {
  it("повторяет правила сервера", () => {
    expect(chatBlockReason({ screen: "all", chat: "off" }, true, { chatMuted: false })).toBe("Хост выключил чат");
    expect(chatBlockReason({ screen: "all", chat: "host" }, false, { chatMuted: false })).toBe(
      "Сейчас писать в чат может только хост",
    );
    expect(chatBlockReason({ screen: "all", chat: "host" }, true, { chatMuted: false })).toBeNull();
    expect(chatBlockReason(ALL, false, { chatMuted: true })).toBe("Хост запретил вам писать в чат");
    expect(chatBlockReason(ALL, true, { chatMuted: true })).toBeNull();
    expect(chatBlockReason(ALL, false, { chatMuted: false })).toBeNull();
  });
});

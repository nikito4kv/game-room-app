import { describe, expect, it } from "vitest";
import type { RoomPublicMeta } from "@/lib/api/contract";
import {
  finishChange,
  patchOf,
  settingsFromMeta,
  shownSettings,
  startChange,
  type InstantSettings,
  type SettingsDraft,
} from "./instantSettings";

const META: RoomPublicMeta = {
  v: 2,
  title: "Катка",
  isPublic: false,
  createdAt: 1,
  hostIdentity: "u_a",
  hostName: "Тёма",
  ownerIdentity: "u_a",
  locked: false,
  hasPassword: false,
  settings: { screen: "all", chat: "all" },
};

const NOW: InstantSettings = settingsFromMeta(META);

describe("settingsFromMeta", () => {
  it("берёт замок, витрину и правила из описания комнаты", () => {
    expect(NOW).toEqual({ locked: false, isPublic: false, screen: "all", chat: "all" });
  });
});

describe("patchOf", () => {
  it("отправляет только нажатое поле", () => {
    expect(patchOf("locked", true)).toEqual({ locked: true });
    expect(patchOf("screen", "host")).toEqual({ screen: "host" });
  });
});

describe("мгновенные настройки", () => {
  it("без нажатий показывает описание комнаты", () => {
    expect(shownSettings(NOW, {})).toEqual(NOW);
  });

  it("выбранное видно сразу, пока сервер не ответил", () => {
    const draft = startChange({}, "chat", "off", 1);
    expect(shownSettings(NOW, draft).chat).toBe("off");
  });

  it("после успеха держит выбранное, пока описание комнаты не догонит", () => {
    let draft = startChange({}, "locked", true, 1);
    draft = finishChange(draft, "locked", 1, true);
    // Ответ пришёл раньше нового описания — переключатель не прыгает назад.
    expect(shownSettings(NOW, draft).locked).toBe(true);
    // Описание догнало — показываем его.
    expect(shownSettings({ ...NOW, locked: true }, draft).locked).toBe(true);
  });

  it("ошибка — откат к описанию комнаты", () => {
    let draft = startChange({}, "screen", "host", 1);
    draft = finishChange(draft, "screen", 1, false);
    expect(draft).toEqual({});
    expect(shownSettings(NOW, draft).screen).toBe("all");
  });

  it("ответ на старое нажатие не трогает новое", () => {
    let draft: SettingsDraft = startChange({}, "locked", true, 1);
    draft = startChange(draft, "locked", false, 2);
    // Первый запрос упал — но человек уже выбрал другое, его и показываем.
    draft = finishChange(draft, "locked", 1, false);
    expect(shownSettings(NOW, draft).locked).toBe(false);
    expect(draft.locked?.seq).toBe(2);
  });

  it("поля независимы: откат одного не трогает другое", () => {
    let draft = startChange({}, "chat", "host", 1);
    draft = startChange(draft, "isPublic", true, 2);
    draft = finishChange(draft, "chat", 1, false);
    expect(shownSettings(NOW, draft)).toEqual({ ...NOW, isPublic: true });
  });
});

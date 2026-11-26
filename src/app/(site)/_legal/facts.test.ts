import { describe, expect, it } from "vitest";
import { AVATAR_TTL_DAYS, KICK_BLOCK_SEC } from "@/lib/api/contract";
import { GALLERY_LIMIT } from "@/lib/rumik/storage";
import { AVATAR_BAN_TTL_SEC, AVATAR_HIDDEN_TTL_SEC, AVATAR_TTL_SEC } from "@/lib/server/avatar";
import { ROOM_FINISHED_GRACE_SECONDS, ROOM_STATE_TTL_SECONDS } from "@/lib/roomSecret";
import { EVENTS_RETENTION_DAYS } from "@/lib/platform/events";
import { LEAD_RETENTION_DAYS } from "@/lib/platform/leadThreads";
import { REPORT_CHAT_SNAPSHOT, REPORT_NOTE_MAX, REPORT_TTL_SEC } from "@/lib/platform/reports";
import { LEGAL_FACTS, PLATFORM_FACTS } from "./facts";

// Тексты политики и условий называют сроки хранения. Если код поменял срок, а
// текст остался, политика начинает врать: этот тест об этом напомнит.
describe("LEGAL_FACTS совпадают с кодом", () => {
  it("состояние комнаты: 48 часов, после закрытия 15 минут", () => {
    expect(ROOM_STATE_TTL_SECONDS).toBe(LEGAL_FACTS.roomStateMaxHours * 3600);
    expect(ROOM_FINISHED_GRACE_SECONDS).toBe(LEGAL_FACTS.roomClosedGraceMinutes * 60);
  });

  it("кик закрывает вход на заявленное число минут", () => {
    expect(KICK_BLOCK_SEC).toBe(LEGAL_FACTS.kickMinutes * 60);
  });
});

describe("PLATFORM_FACTS совпадают с кодом", () => {
  it("жалоба: срок, снимок чата и длина комментария", () => {
    expect(REPORT_TTL_SEC).toBe(PLATFORM_FACTS.reportDays * 24 * 3600);
    expect(REPORT_CHAT_SNAPSHOT).toBe(PLATFORM_FACTS.reportChatSnapshot);
    expect(REPORT_NOTE_MAX).toBe(PLATFORM_FACTS.reportNoteMax);
  });

  it("рисунок Румика: срок на сервере и «Мои Румики» в браузере", () => {
    expect(AVATAR_TTL_SEC).toBe(PLATFORM_FACTS.avatarDays * 24 * 3600);
    expect(AVATAR_TTL_DAYS).toBe(PLATFORM_FACTS.avatarDays);
    expect(GALLERY_LIMIT).toBe(PLATFORM_FACTS.rumikGallery);
  });

  it("сброшенный рисунок: админка видит его, как жалобу; запрет рисунков в комнате — как живёт комната", () => {
    expect(AVATAR_HIDDEN_TTL_SEC).toBe(PLATFORM_FACTS.reportDays * 24 * 3600);
    expect(AVATAR_BAN_TTL_SEC).toBe(LEGAL_FACTS.roomStateMaxHours * 3600);
  });

  it("события с адресом — не дольше заявленного, заявки — 12 месяцев", () => {
    expect(EVENTS_RETENTION_DAYS).toBeLessThanOrEqual(PLATFORM_FACTS.ipDays);
    expect(LEAD_RETENTION_DAYS).toBe(365);
    expect(PLATFORM_FACTS.leadMonths).toBe(12);
  });
});

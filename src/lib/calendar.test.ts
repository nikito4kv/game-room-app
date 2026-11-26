import { describe, expect, it } from "vitest";
import {
  buildIcs,
  defaultMeetingStart,
  googleCalendarUrl,
  icsEscape,
  icsFold,
  icsTime,
  meetingWhen,
  type MeetingInvite,
} from "./calendar";

const meeting: MeetingInvite = {
  title: "Вечерняя катка; CS2, пати",
  url: "https://club.game-room.space/room/K7QMP4",
  start: new Date("2026-10-06T18:00:00Z"),
  durationMin: 120,
  uid: "K7QMP4-1791309600000@game-room.space",
};

describe("встреча в календарь", () => {
  it("время UTC без разделителей и миллисекунд", () => {
    expect(icsTime(new Date("2026-10-06T18:05:09.123Z"))).toBe("20261006T180509Z");
  });

  it("экранирование полей", () => {
    expect(icsEscape("a;b,c\\d\ne")).toBe("a\\;b\\,c\\\\d\\ne");
  });

  it("перенос длинных строк: каждая не длиннее 75 байт, кириллица не рвётся", () => {
    const long = `DESCRIPTION:${"Заходи по ссылке ".repeat(10)}`;
    const folded = icsFold(long).split("\r\n");
    expect(folded.length).toBeGreaterThan(1);
    for (const l of folded) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(folded.map((l, i) => (i ? l.slice(1) : l)).join("")).toBe(long);
  });

  it(".ics: одна встреча на 2 часа с напоминанием, строки через CRLF", () => {
    const ics = buildIcs(meeting, new Date("2026-10-06T12:00:00Z"));
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.split("\r\n").every((l) => !l.includes("\n"))).toBe(true);
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("DTSTART:20261006T180000Z");
    expect(unfolded).toContain("DTEND:20261006T200000Z");
    expect(unfolded).toContain("SUMMARY:Game Room: «Вечерняя катка\\; CS2\\, пати»");
    expect(unfolded).toContain(`UID:${meeting.uid}`);
    expect(unfolded).toContain("TRIGGER:-PT10M");
  });

  it("ссылка Google Календаря с теми же временем и ссылкой", () => {
    const url = new URL(googleCalendarUrl(meeting));
    expect(url.hostname).toBe("calendar.google.com");
    expect(url.searchParams.get("dates")).toBe("20261006T180000Z/20261006T200000Z");
    expect(url.searchParams.get("location")).toBe(meeting.url);
  });

  it("когда словами: сегодня, завтра, дата", () => {
    const now = new Date(2026, 9, 6, 12, 0);
    expect(meetingWhen(new Date(2026, 9, 6, 21, 0), now)).toBe("сегодня в 21:00");
    expect(meetingWhen(new Date(2026, 9, 7, 9, 30), now)).toBe("завтра в 9:30");
    expect(meetingWhen(new Date(2026, 9, 8, 21, 0), now)).toBe("8 октября в 21:00");
  });

  it("по умолчанию — ближайшие 21:00; за 15 минут до них — уже завтра", () => {
    expect(defaultMeetingStart(new Date(2026, 9, 6, 12, 0))).toEqual(new Date(2026, 9, 6, 21, 0));
    expect(defaultMeetingStart(new Date(2026, 9, 6, 20, 50))).toEqual(new Date(2026, 9, 7, 21, 0));
  });
});

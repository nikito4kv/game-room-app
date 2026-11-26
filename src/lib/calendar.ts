// «Собираемся в 21:00» — встреча в календарь без аккаунтов: файл .ics (его
// открывают и Google, и Apple, и Outlook) и ссылка «добавить в Google Календарь».
// Чистые функции без браузера — тест рядом.

export type MeetingInvite = {
  /** Название комнаты. */
  title: string;
  /** Ссылка на комнату. */
  url: string;
  start: Date;
  /** Длительность, мин. */
  durationMin: number;
  /** Устойчивый id события (повторный импорт не плодит копии). */
  uid: string;
};

/** Время в формате iCalendar UTC: 20261006T180000Z. */
export function icsTime(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** Текст поля iCalendar: обратная косая, запятая, точка с запятой и перевод строки экранируются. */
export function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Строка длиннее 75 байт переносится (RFC 5545, 3.1): продолжение начинается с пробела. */
export function icsFold(line: string): string {
  const bytes = new TextEncoder();
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (bytes.encode(cur + ch).length > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

function eventText(m: MeetingInvite): { summary: string; description: string } {
  return {
    summary: `Game Room: «${m.title}»`,
    description: `Заходи по ссылке — голос и показ экрана, без регистрации: ${m.url}`,
  };
}

/** Файл .ics с одной встречей и напоминанием за 10 минут. Строки — через CRLF. */
export function buildIcs(m: MeetingInvite, now: Date = new Date()): string {
  const end = new Date(m.start.getTime() + m.durationMin * 60_000);
  const { summary, description } = eventText(m);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Game Room//RU",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${m.uid}`,
    `DTSTAMP:${icsTime(now)}`,
    `DTSTART:${icsTime(m.start)}`,
    `DTEND:${icsTime(end)}`,
    `SUMMARY:${icsEscape(summary)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    `LOCATION:${icsEscape(m.url)}`,
    `URL:${m.url}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsEscape(summary)}`,
    "TRIGGER:-PT10M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(icsFold).join("\r\n") + "\r\n";
}

/** Ссылка «Добавить в Google Календарь» с той же встречей. */
export function googleCalendarUrl(m: MeetingInvite): string {
  const end = new Date(m.start.getTime() + m.durationMin * 60_000);
  const { summary, description } = eventText(m);
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: summary,
    dates: `${icsTime(m.start)}/${icsTime(end)}`,
    details: description,
    location: m.url,
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/** «сегодня в 21:00», «завтра в 9:30», иначе «8 октября в 21:00» — по местному времени. */
export function meetingWhen(start: Date, now: Date = new Date()): string {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(start) - day(now)) / 86_400_000);
  const time = `${start.getHours()}:${String(start.getMinutes()).padStart(2, "0")}`;
  if (diff === 0) return `сегодня в ${time}`;
  if (diff === 1) return `завтра в ${time}`;
  const date = start.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  return `${date} в ${time}`;
}

/** Ближайшие «ровные» 21:00: сегодня, если ещё не поздно, иначе завтра. */
export function defaultMeetingStart(now: Date = new Date(), hour = 21): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0);
  if (d.getTime() - now.getTime() < 15 * 60_000) d.setDate(d.getDate() + 1);
  return d;
}

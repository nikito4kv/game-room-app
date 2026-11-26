"use client";

import { useMemo, useState } from "react";
import { Button, TextField, buttonClass, cn, toast } from "@/components/ui";
import { buildIcs, defaultMeetingStart, googleCalendarUrl, meetingWhen, type MeetingInvite } from "@/lib/calendar";
import { copyText } from "./invite";

/** Комната живёт 48 ч с последнего визита: встречу дальше не предлагаем. */
const MAX_AHEAD_MS = 47 * 3_600_000;
const DURATION_MIN = 120;

/** Date ↔ значение <input type="datetime-local"> (местное время, без секунд). */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * «Собираемся в…» в панели «Пригласить» (флаг calendar): время встречи — по
 * умолчанию ближайшие 21:00, — и три способа позвать к нему: файл .ics (его
 * открывают Google, Apple и Outlook), «Google Календарь» и готовое сообщение
 * «Собираемся сегодня в 21:00: ссылка» для чата. Комната живёт 48 ч с последнего
 * визита — время дальше не берём.
 */
export function CalendarInvite({ link, title, code }: { link: string; title: string; code: string }) {
  const [value, setValue] = useState(() => toLocalInput(defaultMeetingStart()));
  const start = useMemo(() => new Date(value), [value]);
  // «Сейчас» — на момент открытия панели: границы выбора не прыгают при перерисовке.
  const [now] = useState(() => Date.now());
  const valid =
    Number.isFinite(start.getTime()) && start.getTime() > now - 5 * 60_000 && start.getTime() < now + MAX_AHEAD_MS;
  const meeting: MeetingInvite = {
    title,
    url: link,
    start,
    durationMin: DURATION_MIN,
    uid: `${code}-${start.getTime()}@game-room`,
  };

  const download = () => {
    const blob = new Blob([buildIcs(meeting)], { type: "text/calendar;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `game-room-${code}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1_000);
  };
  const copy = () => {
    const text = `Собираемся ${meetingWhen(start)} в «${title}»: ${link}`;
    void copyText(text).then((ok) =>
      toast(
        ok
          ? { id: "invite", icon: "copy", title: "Приглашение со временем скопировано", description: text }
          : { id: "invite", tone: "caution", title: "Не получилось скопировать", description: text },
      ),
    );
  };

  return (
    <div className="flex flex-col gap-3" data-testid="invite-calendar">
      <TextField
        type="datetime-local"
        label="Собираемся в…"
        value={value}
        min={toLocalInput(new Date(now))}
        max={toLocalInput(new Date(now + MAX_AHEAD_MS))}
        onChange={(e) => setValue(e.target.value)}
        error={valid ? undefined : "Выберите время в ближайшие двое суток"}
        data-testid="invite-calendar-time"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon="download"
          disabled={!valid}
          onClick={download}
          data-testid="invite-ics"
        >
          Файл .ics
        </Button>
        <a
          href={valid ? googleCalendarUrl(meeting) : undefined}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={!valid}
          className={cn(buttonClass({ variant: "secondary", size: "sm" }), !valid && "pointer-events-none opacity-45")}
          data-testid="invite-google"
        >
          Google Календарь
        </a>
        <Button size="sm" variant="secondary" icon="copy" disabled={!valid} onClick={copy} data-testid="invite-when">
          Текст со временем
        </Button>
      </div>
    </div>
  );
}

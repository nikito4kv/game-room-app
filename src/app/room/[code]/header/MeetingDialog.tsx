"use client";

import { Dialog } from "@/components/ui";
import { CalendarInvite } from "./CalendarInvite";

/**
 * «Назначить встречу» из меню комнаты (флаг calendar): время, .ics и ссылка
 * Google Календаря. Отдельно от «Пригласить»: пригласить — позвать сейчас, а это
 * — договориться на потом, и друзьям уходит ссылка на ту же комнату со временем.
 */
export function MeetingDialog({
  open,
  onOpenChange,
  link,
  title,
  code,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  link: string;
  title: string;
  code: string;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title="Назначить встречу"
      description="Друзья получат напоминание в календарь и ссылку на эту комнату. Комната живёт двое суток с последнего визита."
      data-testid="meeting-dialog"
    >
      {open && <CalendarInvite link={link} title={title} code={code} />}
    </Dialog>
  );
}

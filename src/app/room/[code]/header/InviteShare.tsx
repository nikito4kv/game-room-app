"use client";

import { useState } from "react";
import { Button, QrCode, buttonClass, cn, toast } from "@/components/ui";
import { copyText, inviteMessage, shareUrls } from "./invite";

/**
 * «Позвать» в панели «Пригласить» (флаг invite_share): одна строка из четырёх
 * кнопок — Telegram и VK (их ссылки «поделиться», новая вкладка, текст уже
 * вставлен), Discord (готовое сообщение в буфер: своей ссылки у Discord нет) и
 * QR (раскрывается под строкой — навести телефон). Время и календарь — не здесь:
 * это «Назначить встречу» в меню комнаты. Витрина — /design/room?invite=1.
 */
export function InviteShare({ link, title, code }: { link: string; title: string; code: string }) {
  const [qr, setQr] = useState(false);
  const urls = shareUrls(link, title);
  const copyMessage = () =>
    void copyText(inviteMessage(link, title)).then((ok) =>
      toast(
        ok
          ? { id: "invite", icon: "copy", title: "Приглашение скопировано", description: "Вставьте его в Discord" }
          : { id: "invite", tone: "caution", title: "Не получилось скопировать", description: link },
      ),
    );
  const cell = cn(buttonClass({ variant: "secondary", size: "sm" }), "w-full");
  return (
    <div className="flex flex-col gap-3" data-testid="invite-share">
      <div className="grid grid-cols-4 gap-2">
        <a
          href={urls.telegram}
          target="_blank"
          rel="noopener noreferrer"
          className={cell}
          data-testid="invite-telegram"
        >
          Telegram
        </a>
        <a href={urls.vk} target="_blank" rel="noopener noreferrer" className={cell} data-testid="invite-vk">
          VK
        </a>
        <Button size="sm" variant="secondary" block onClick={copyMessage} data-testid="invite-discord">
          Discord
        </Button>
        <Button
          size="sm"
          variant={qr ? "primary" : "secondary"}
          block
          aria-expanded={qr}
          onClick={() => setQr((v) => !v)}
          data-testid="invite-qr-toggle"
        >
          QR
        </Button>
      </div>
      {qr && (
        <div className="flex items-center gap-3 rounded-card bg-sunken p-3">
          <QrCode value={link} label={`QR-код ссылки на комнату ${code}`} size={120} />
          <p className="text-label text-ink-2">Наведите камеру телефона: откроется эта комната.</p>
        </div>
      )}
    </div>
  );
}

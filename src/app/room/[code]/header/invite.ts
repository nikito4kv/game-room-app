"use client";

import { toast } from "@/components/ui";

/** Ссылка-приглашение в комнату: https://<сайт>/room/<КОД>. */
export function inviteLink(code: string): string {
  return `${window.location.origin}/room/${code}`;
}

/** Та же ссылка без протокола — для показа в поле («club.game-room.space/room/K7QMP4»). */
export function inviteLinkShort(code: string): string {
  return `${window.location.host}/room/${code}`;
}

/**
 * Готовое приглашение одним сообщением: для Discord (там своей ссылки «поделиться»
 * нет — копируем текст, превью комнаты Discord покажет сам по ссылке).
 */
export function inviteMessage(link: string, title: string): string {
  return `Заходи в комнату «${title}» — голос и показ экрана, без регистрации: ${link}`;
}

/** Ссылки «поделиться» мессенджеров: открываются в новой вкладке, текст уже вставлен. */
export function shareUrls(link: string, title: string): { telegram: string; vk: string } {
  const text = `Заходи в комнату «${title}» — голос и показ экрана, без регистрации`;
  return {
    telegram: `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`,
    vk: `https://vk.com/share.php?url=${encodeURIComponent(link)}&title=${encodeURIComponent(text)}`,
  };
}

/**
 * Скопировать текст. Небезопасный контекст или старый браузер — запасной путь
 * через временное поле. false — не вышло (тогда не врём «скопировано»).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

/**
 * Звать через системное меню «Поделиться» (Telegram, WhatsApp…) — только на
 * сенсорных экранах. На Windows navigator.share тоже есть, но там привычнее и
 * быстрее просто скопировать ссылку.
 */
export function canShareInvite(): boolean {
  return typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches;
}

/**
 * Открыть системное меню «Поделиться» со ссылкой. Вызывать из жеста (клик).
 * "cancelled" — человек закрыл меню (это не ошибка), "failed" — меню не
 * открылось: тогда копируем, как на компьютере.
 */
export async function shareInvite(code: string, title: string): Promise<"shared" | "cancelled" | "failed"> {
  try {
    await navigator.share({ title: `${title} · Game Room`, text: `Заходи в комнату «${title}»`, url: inviteLink(code) });
    return "shared";
  } catch (e) {
    return e instanceof DOMException && e.name === "AbortError" ? "cancelled" : "failed";
  }
}

/** Скопировать ссылку-приглашение и сказать об этом тостом. */
export async function copyInviteWithToast(code: string): Promise<void> {
  const ok = await copyText(inviteLink(code));
  toast(
    ok
      ? { id: "invite", icon: "link", title: "Ссылка скопирована", description: "Отправьте её друзьям. Регистрация не нужна." }
      : { id: "invite", tone: "caution", title: "Не получилось скопировать", description: inviteLink(code) },
  );
}

/** Скопировать код комнаты — его удобно продиктовать голосом. */
export async function copyCodeWithToast(code: string): Promise<void> {
  const ok = await copyText(code);
  toast(
    ok
      ? { id: "invite", icon: "hash", title: "Код скопирован", description: code }
      : { id: "invite", tone: "caution", title: "Не получилось скопировать", description: code },
  );
}

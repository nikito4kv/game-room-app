// Страница заявки /request/<id> (А5): тексты статуса и времени — чистые функции.
import type { LeadStatus } from "@/lib/api/platform";

export const LEAD_STATUS_TEXT: Record<LeadStatus, { label: string; hint: string; tone: "neutral" | "signal" | "caution" }> = {
  new: { label: "Отправлена", hint: "Заявка у нас. Обычно отвечаем в течение дня.", tone: "neutral" },
  in_progress: { label: "Читаем", hint: "Заявку уже смотрят. Ответ появится здесь.", tone: "caution" },
  answered: { label: "Есть ответ", hint: "Мы ответили. Можно дописать, если остались вопросы.", tone: "signal" },
  paying: { label: "Оформляем", hint: "Договорились — доводим до дела.", tone: "signal" },
  closed: { label: "Закрыта", hint: "Заявка закрыта. Если вопрос остался, напишите — мы увидим.", tone: "neutral" },
};

export function leadStatusText(status: unknown) {
  return typeof status === "string" && status in LEAD_STATUS_TEXT
    ? LEAD_STATUS_TEXT[status as LeadStatus]
    : LEAD_STATUS_TEXT.new;
}

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

/** «21:07» сегодня, «вчера, 21:07», «5 октября, 21:07», с годом — если не в этом году. */
export function formatLeadTime(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((day(now) - day(d)) / 86_400_000);
  if (diffDays === 0) return hm;
  if (diffDays === 1) return `вчера, ${hm}`;
  const date = `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ""}`;
  return `${date}, ${hm}`;
}

/** Токен из адреса страницы (?t=). */
export function tokenFromSearch(search: string): string | null {
  const t = new URLSearchParams(search).get("t")?.trim();
  return t ? t : null;
}

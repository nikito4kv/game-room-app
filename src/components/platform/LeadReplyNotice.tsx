"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/components/ui/cn";
import { getLeadsStatus } from "@/lib/client/api";
import { getMyLeads } from "@/lib/client/myLeads";

/** Как часто спрашиваем «есть ли ответ», пока страница открыта. */
export const LEAD_STATUS_POLL_MS = 120_000;

/**
 * Метка в шапке сайта «Есть ответ на заявку» (А5): ведёт в переписку. Спрашиваем
 * сервер при загрузке, при смене страницы и раз в 2 минуты — только если с этого браузера уже
 * отправляли заявки. Ответа нет или заявок нет — ничего не рисуем.
 */
export function LeadReplyNotice({ className }: { className?: string }) {
  const pathname = usePathname();
  // Ссылка на заявку с непрочитанным ответом (с токеном).
  const [href, setHref] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const mine = getMyLeads();
    if (mine.length === 0) return;
    let ctrl: AbortController | null = null;
    const check = () => {
      if (document.visibilityState !== "visible") return;
      ctrl?.abort();
      ctrl = new AbortController();
      getLeadsStatus(
        mine.map((l) => ({ id: l.id, t: l.t })),
        ctrl.signal,
      ).then(
        (res) => {
          const unread = (Array.isArray(res.items) ? res.items : []).find((i) => i.hasUnread);
          const lead = unread ? mine.find((l) => l.id === unread.id) : undefined;
          setOpenId(lead?.id ?? null);
          setHref(lead ? `/request/${encodeURIComponent(lead.id)}?t=${encodeURIComponent(lead.t)}` : null);
        },
        () => {
          // сеть, флаг заявок выключен — метку просто не показываем
        },
      );
    };
    check();
    const timer = window.setInterval(check, LEAD_STATUS_POLL_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      ctrl?.abort();
    };
    // Смена страницы — проверяем заново: из переписки вернулись, ответ уже прочитан.
  }, [pathname]);

  // Уже читаем эту переписку — метка не нужна.
  if (!href || (openId && pathname === `/request/${openId}`)) return null;

  return (
    <Link
      href={href}
      data-testid="lead-reply-notice"
      aria-label="Есть ответ на заявку"
      className={cn(
        "relative inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-signal/35 bg-signal-wash text-label font-medium text-signal-ink transition-colors duration-140 hover:border-signal/60 max-sm:w-9 max-sm:justify-center sm:px-3",
        className,
      )}
    >
      {/* Узко — круглая кнопка с точкой, широко — точка и текст. */}
      <span className="size-2 shrink-0 rounded-full bg-signal max-sm:absolute max-sm:right-0.5 max-sm:top-0.5" aria-hidden="true" />
      <Icon name="chat" size={16} className="shrink-0" />
      <span className="max-sm:hidden">Есть ответ на заявку</span>
    </Link>
  );
}

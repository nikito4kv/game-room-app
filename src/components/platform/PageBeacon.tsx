"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { sendPageBeacon } from "@/lib/client/beacon";

/**
 * Маяк посещений (А4): на каждую смену страницы — одно событие в /api/ev. Ничего
 * не рисует. Стоит в корневом макете, поэтому видит и сайт, и комнату, и заявку.
 */
export function PageBeacon() {
  const pathname = usePathname();
  // Последний отправленный путь: в dev React зовёт эффект дважды — второй раз не шлём.
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (!pathname || sent.current === pathname) return;
    sendPageBeacon(pathname, sent.current === null);
    sent.current = pathname;
  }, [pathname]);
  return null;
}

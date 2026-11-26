"use client";

import { useEffect, useState } from "react";

/**
 * Сколько секунд осталось до момента until (мс эпохи); 0 — время вышло или
 * отсчёта нет. Тикает раз в секунду, только пока идёт отсчёт; новый until сразу
 * берёт свежее «сейчас», а не время монтирования.
 */
export function useCountdown(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    const update = () => {
      const t = Date.now();
      setNow(t);
      if (t >= until) clearInterval(id);
    };
    const first = setTimeout(update, 0);
    const id = setInterval(update, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [until]);
  return until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
}

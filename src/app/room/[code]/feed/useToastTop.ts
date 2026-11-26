"use client";

import { useLayoutEffect, type RefObject } from "react";
import { toastTop } from "@/lib/room/zoneLayout";

/** Части экрана комнаты, от которых зависит, куда встают тосты. */
export type ToastTopParts = {
  /** Корень экрана: на нём живёт --gr-toast-top (его читает Toaster). */
  root: RefObject<HTMLElement | null>;
  /** Зона комнаты (<main>): её верх — низ шапки и полосы связи. */
  zone: RefObject<HTMLElement | null>;
  /** Обёртка плашек над зоной; пустая — плашек нет. */
  banners: RefObject<HTMLElement | null>;
  /** Сцена показа экрана, пока она на экране. */
  stage: RefObject<HTMLElement | null>;
  /** Список участников — только в раскладке «список». */
  list: RefObject<HTMLElement | null>;
  dock: RefObject<HTMLElement | null>;
};

/**
 * Держит --gr-toast-top на корне комнаты: тосты встают туда, где ничего не
 * закрывают (правила — toastTop). Пересчёт только по ResizeObserver: окно,
 * плашки, список, чат или сцена поменяли размер. В покое — ни таймеров, ни
 * перерисовок React: переменная пишется прямо в style.
 *
 * layoutKey — после чего части экрана могли смениться (раскладка, сцена):
 * тогда наблюдение ставится заново на новые элементы.
 */
export function useToastTop(parts: ToastTopParts, layoutKey: string): void {
  const { root, zone, banners, stage, list, dock } = parts;
  useLayoutEffect(() => {
    const rootEl = root.current;
    const zoneEl = zone.current;
    if (!rootEl || !zoneEl) return;
    const update = () => {
      const bannersEl = banners.current;
      const stageEl = stage.current;
      const listEl = list.current;
      const zoneRect = zoneEl.getBoundingClientRect();
      const top = toastTop({
        zoneTop: zoneRect.top,
        // У пустой обёртки display: none — высота 0, плашек нет.
        bannersBottom: bannersEl && bannersEl.offsetHeight > 0 ? bannersEl.getBoundingClientRect().bottom : null,
        stageTop: stageEl ? stageEl.getBoundingClientRect().top : null,
        list: listEl ? { contentBottom: listEl.getBoundingClientRect().bottom, zoneBottom: zoneRect.bottom } : null,
        dockTop: dock.current?.getBoundingClientRect().top ?? window.innerHeight,
      });
      rootEl.style.setProperty("--gr-toast-top", `${top}px`);
    };
    const ro = new ResizeObserver(update);
    for (const el of [rootEl, zoneEl, banners.current, stage.current, list.current, dock.current]) {
      if (el) ro.observe(el);
    }
    update();
    return () => ro.disconnect();
  }, [layoutKey, root, zone, banners, stage, list, dock]);
}

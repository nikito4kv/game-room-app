"use client";

import { useLayoutEffect } from "react";
import { usePublicConfig } from "@/lib/client/usePublicConfig";

/**
 * Аварийный выключатель украшений витрины: флаг rumik_decor в админке (А3).
 * Выключен — ставит на <html> data-decor="off", и всё с классом DECOR_OFF
 * (SideDecor, DecorSquare, Румики в секциях, «стена») прячется. Запрос
 * настроек тот же, что у полосы объявлений, — второго не будет.
 * Ничего не рисует. Пока ответа нет — украшения видны (флаг по умолчанию включён).
 */
export function DecorSwitch() {
  const config = usePublicConfig();
  const off = config?.flags.rumik_decor === false;
  // До отрисовки: при переходе по сайту с уже загруженными настройками декор не мелькает.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (off) root.dataset.decor = "off";
    else delete root.dataset.decor;
    return () => {
      delete root.dataset.decor;
    };
  }, [off]);
  return null;
}

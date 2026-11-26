"use client";

import { useId, type ReactNode } from "react";
import { LazyRumikEditor } from "@/components/rumik/LazyRumikEditor";
import { PostcardButton } from "@/components/rumik/PostcardButton";
import type { RumikEditorEvent } from "@/lib/analytics/rumik";
import { usePublicConfig } from "@/lib/client/usePublicConfig";

/**
 * Рисовалка Румика в герое главной (R2): код рисовалки грузится лениво, до него
 * стоит заглушка того же размера. «Открытка» — лёгкая кнопка, окно с ней
 * приезжает по нажатию. Выключен флаг rumik_editor — прежняя картинка «как это
 * выглядит» (`table`: круглый стол с кружками, TablePreview variant="avatars",
 * её рисует сервер). Пока настройки не пришли — рисовалка: флаг по умолчанию
 * включён.
 *
 * Своя область с заголовком для скринридера: иначе «Мои Румики» (h3) попадали
 * бы под «Недавние комнаты» (h2) из соседней колонки.
 */
// События рисовалки редкие (первый штрих, файл), а главная считает каждый
// килобайт: модуль событий подгружается при первом же событии.
function sendEvent(e: RumikEditorEvent) {
  void import("@/lib/analytics/rumik").then((m) => m.trackRumikEditor(e, "hero"));
}

export function HeroRumik({ table, className }: { table: ReactNode; className?: string }) {
  const config = usePublicConfig();
  const titleId = useId();
  if (config?.flags.rumik_editor === false) return table;
  return (
    <section aria-labelledby={titleId} className={className}>
      <h2 id={titleId} className="sr-only">
        Ваш Румик
      </h2>
      <LazyRumikEditor
        variant="hero"
        onEvent={sendEvent}
        actions={<PostcardButton place="hero" />}
      />
    </section>
  );
}

import type { Metadata } from "next";
import { getRoomMetaForOg } from "@/lib/ogRoomMeta";
import { SITE_OPEN_GRAPH } from "@/lib/siteMeta";
import RoomClient from "./RoomClient";

/**
 * OG-метаданные комнаты для превью ссылок (Discord/Telegram/Slack). Название
 * берём из публичных metadata LiveKit (loadPublicMeta) — это не секрет, оно видно
 * всем участникам; доступ защищают код и пароль. Поэтому показываем название и
 * для приватных комнат: их ссылку хост шарит намеренно — в этом и смысл фичи.
 * OG-картинку явно не указываем — Next подхватит соседний opengraph-image.tsx.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const upper = code.toUpperCase();
  const meta = await getRoomMetaForOg(upper);

  // Комнаты — по приглашению: в поиске им делать нечего.
  const robots = { index: false, follow: false };
  if (!meta) {
    return { title: "Комната не найдена", robots };
  }

  // Вкладка — «Вечерняя катка · Game Room» (шаблон из layout): по Alt-Tab из
  // игры видно, какая это комната. Внутри комнаты чат дописывает спереди
  // «(3)» — непрочитанные. Превью ссылки в мессенджере зовёт войти.
  const invite = `Зайти в комнату «${meta.title}»`;
  const description = `Голосовая игровая комната «${meta.title}». Заходи по коду ${upper}.`;
  return {
    title: meta.title,
    description,
    robots,
    // Next не сливает openGraph с корневым: имя сайта и язык подмешиваем сами,
    // иначе в превью ссылки пропадут og:site_name и og:locale.
    openGraph: {
      ...SITE_OPEN_GRAPH,
      title: invite,
      description,
      url: `/room/${upper}`,
    },
    // card задаём явно: twitter-объект ребёнка заменяет родительский целиком,
    // иначе summary_large_image из layout потерялся бы и стал бы summary.
    twitter: { card: "summary_large_image", title: invite, description },
  };
}

// В Next.js 16 params — это Promise, поэтому страница асинхронная.
export default async function RoomPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <RoomClient code={code.toUpperCase()} />;
}

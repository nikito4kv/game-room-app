import type { Metadata } from "next";
import { Rumik } from "@/components/ui/Rumik";
import { DecorWall } from "@/components/marketing/decor/DecorWall";
import { DecorSquare, SideDecor } from "@/components/marketing/decor/SideDecor";
import { SITE_OPEN_GRAPH } from "@/lib/siteMeta";
import { OpenRooms } from "../_components/OpenRooms";

const TITLE = "Открытые комнаты";
const DESCRIPTION = "Комнаты, которые хосты показали всем. Заходите к тем, кто уже на связи.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  // openGraph и twitter заменяют корневые целиком — базу подмешиваем сами.
  openGraph: { ...SITE_OPEN_GRAPH, title: TITLE, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// Витрина открытых комнат. Заголовок — статический, список грузится в браузере
// (GET /api/rooms): он живой, кэшировать его на сервере незачем.
// main во всю ширину и relative: от него считают позицию украшения по краям.
export default function RoomsPage() {
  return (
    <>
      <DecorWall />
      <main className="relative flex-1">
        <div className="mx-auto w-full max-w-[880px] px-5 pb-16 pt-6 lg:pt-10">
          <h1 className="font-brand text-display text-ink">{TITLE}</h1>
          <p className="mt-2 max-w-[56ch] text-pretty text-body-lg text-ink-2">{DESCRIPTION}</p>
          {/* Спит: в списке пусто, пока кто-то не откроет комнату для всех. */}
          <OpenRooms
            emptyVisual={
              <Rumik colors={[4, 3, 5, 6]} sticker eyes="sleep" extra="zzz" tilt={-5} size={180} className="mb-2" />
            }
          />
        </div>
        {/* Скромнее, чем на главной: один Румик у колонки 880 показывает на список (в пустом
            списке есть свой, спящий), и пара тихих квадратов. */}
        <SideDecor side="left" top={110} column={880}>
          <Rumik pose="point" colors={[6, 5, 4, 2]} sticker look={[3, 1]} />
        </SideDecor>
        <DecorSquare side="right" top={140} inset={50} size={26} color={3} rotate={-10} column={880} />
        <DecorSquare side="left" top={420} inset={60} size={20} color={8} rotate={12} filled column={880} />
      </main>
    </>
  );
}

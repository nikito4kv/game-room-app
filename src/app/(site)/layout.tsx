import { UiRoot } from "@/components/ui/UiRoot";
import { AnnouncementBar } from "@/components/platform/AnnouncementBar";
import { DecorSwitch } from "@/components/marketing/decor/DecorSwitch";
import { SiteHeader } from "./_components/SiteHeader";

// Каркас страниц сайта: лендинг и открытые комнаты. Шапка общая и не
// перерисовывается при переходе между ними. Комната (/room/…) живёт вне этой
// группы маршрутов — у неё своя шапка и свой полноэкранный корень.
//
// `isolate` у корня — для «стены» витрины (DecorWall): она стоит с отрицательным
// z-index и так рисуется над фоном страницы, но под всем содержимым.
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <UiRoot className="isolate flex min-h-dvh flex-col">
      {/* Выключатель украшений витрины по флагу rumik_decor; сам ничего не рисует. */}
      <DecorSwitch />
      <SiteHeader />
      {/* Объявления администрации (техработы, новости) — под шапкой, во всю ширину. */}
      <AnnouncementBar />
      {children}
    </UiRoot>
  );
}

import type { Metadata } from "next";
import { assignAvatarColors } from "@/components/ui/avatarColor";
import { Rumik } from "@/components/ui/Rumik";
import { TablePreview, type TableGuest } from "@/components/ui/TablePreview";
import { Benefits } from "@/components/marketing/Benefits";
import { ClubTeaser } from "@/components/marketing/ClubTeaser";
import { Faq } from "@/components/marketing/Faq";
import { HOME_FAQ } from "@/components/marketing/faqData";
import { FinalCta } from "@/components/marketing/FinalCta";
import { HowItWorks } from "@/components/marketing/HowItWorks";
import { PricingTeaser } from "@/components/marketing/PricingTeaser";
import { Section } from "@/components/marketing/Section";
import { DecorWall } from "@/components/marketing/decor/DecorWall";
import { DecorSquare, SideDecor } from "@/components/marketing/decor/SideDecor";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { pageMetadata } from "@/components/marketing/seo";
import { SITE_NAME } from "@/lib/siteMeta";
import { CreateRoomCard } from "./_components/CreateRoomCard";
import { JoinRoomCard } from "./_components/JoinRoomCard";
import { HeroRumik } from "./_components/HeroRumik";
import { RecentRooms } from "./_components/RecentRooms";

// Лендинг. Сверху герой: слева обещание и рисовалка Румика (R2; флаг rumik_editor
// выключен — мини-стол из настоящих аватаров), справа действия: создать комнату,
// войти по коду или ссылке, недавние. Это главный сценарий, его не трогаем. Ниже
// сгиба продающий слой (компоненты в src/components/marketing): как это работает,
// чем удобно, клубы, тарифы, вопросы. Страница статическая: интерактивны карточки
// справа, рисовалка (её код грузится лениво) и пара примеров в плитках.
// Бренд-слой (DESIGN_SYSTEM.md §8): «стена» на очень широком окне, Румики и
// квадраты по краям колонки — всё декоративное, на узком экране его нет.

const TITLE = `${SITE_NAME} · голосовая комната для своих`;
const DESCRIPTION =
  "Одна ссылка, и вы слышите друг друга: голос, чат и показ экрана со звуком в браузере. Без регистрации и установки.";

export const metadata: Metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: "/", absoluteTitle: true });

const DEMO_NAMES = ["Тёма", "Ника", "Лёха", "Даня Котов"];
const DEMO_COLORS = assignAvatarColors(DEMO_NAMES);
const DEMO: TableGuest[] = [
  { name: DEMO_NAMES[0], colorIndex: DEMO_COLORS[0], host: true, speaking: true, level: 0.85 },
  { name: DEMO_NAMES[1], colorIndex: DEMO_COLORS[1] },
  { name: DEMO_NAMES[2], colorIndex: DEMO_COLORS[2], status: "muted" },
  { name: DEMO_NAMES[3], colorIndex: DEMO_COLORS[3] },
];

export default function HomePage() {
  return (
    <>
      <DecorWall />
      <main className="flex-1">
        {/* Герой во всю ширину: украшениям по краям нужно место за колонкой 1200.
            На широком — две колонки: слева обещание и рисовалка, справа карточки.
            На узком — одна, и рисовалка после карточек: главное здесь — создать комнату. */}
        <div className="relative">
          <div className="mx-auto grid w-full max-w-[1200px] gap-10 px-5 pb-16 pt-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:grid-rows-[auto_1fr] lg:gap-x-16 lg:gap-y-0 lg:pt-14">
            <section className="flex min-w-0 flex-col lg:col-start-1 lg:row-start-1">
              <h1 className="text-balance font-brand text-hero text-ink">
                Заходи,
                <br />
                тут все свои
              </h1>
              <p className="mt-6 max-w-[44ch] text-pretty text-body-lg text-ink-2 sm:text-[17px] sm:leading-[1.55]">
                Голосовая комната для своей компании. Одна ссылка, и вы слышите друг друга. Чат и показ экрана внутри,
                без регистрации.
              </p>
            </section>

            <div className="flex min-w-0 flex-col gap-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
              {/* #create: сюда ведёт кнопка «Создать комнату» из финального призыва. */}
              <div id="create" className="scroll-mt-4">
                <CreateRoomCard />
              </div>
              <JoinRoomCard />
              <RecentRooms />
            </div>

            <HeroRumik
              className="min-w-0 lg:col-start-1 lg:row-start-2 lg:mt-8 lg:self-start"
              table={
                // Флаг rumik_editor выключен: прежняя картинка «как это выглядит», на узком её нет.
                <div className="mt-4 h-[460px] w-full max-w-[560px] [container-type:size] max-lg:hidden lg:col-start-1 lg:row-start-2">
                  <div className="grid h-full place-items-center">
                    <TablePreview people={DEMO} seat="lg" variant="avatars" />
                  </div>
                </div>
              }
            />
          </div>
          <SideDecor side="left" top={360}>
            <Rumik pose="wave" colors={[6, 5, 4, 2]} sticker look={[3, 0]} />
          </SideDecor>
          <SideDecor side="right" top={24}>
            <Rumik pose="point" colors={[1, 0, 9, 2]} sticker hat="cap" flip look={[-3, 2]} />
          </SideDecor>
          <DecorSquare side="left" top={160} inset={20} size={30} color={5} rotate={12} />
          <DecorSquare side="left" top={700} inset={60} size={18} color={0} rotate={-14} filled />
          {/* В макете 640 и 770, но там герой на ~65 px выше (подсказка, «Спереди/Сзади», кружки
              под фигурой — их убрали). Сдвинуты вверх, чтобы квадрат лёг над головой Румика,
              сидящего на линии ниже, а не на неё. */}
          <DecorSquare side="right" top={590} inset={30} size={34} color={3} rotate={-10} filled />
          <DecorSquare side="right" top={700} inset={80} size={22} color={8} rotate={18} />
        </div>

        <HowItWorks />
        <Benefits />
        <ClubTeaser />
        <PricingTeaser />
        <Section
          id="faq"
          title="Частые вопросы"
          decor={
            <>
              <SideDecor side="right" sit>
                <Rumik pose="sit" colors={[5, 6, 7, 4]} sticker extra="q" flip look={[-2, -2]} />
              </SideDecor>
              <DecorSquare side="left" top={130} inset={50} size={22} color={8} rotate={-10} filled />
            </>
          }
        >
          <div className="max-w-[820px]">
            <Faq items={HOME_FAQ} />
          </div>
        </Section>
        <FinalCta />
      </main>
      <SiteFooter sleeper />
    </>
  );
}

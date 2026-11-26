import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/icons";
import { InlineAlert } from "@/components/ui/InlineAlert";
import { Rumik } from "@/components/ui/Rumik";
import { glueShortWords } from "@/components/ui/typography";
import { DecorWall } from "@/components/marketing/decor/DecorWall";
import { DecorSquare, SideDecor } from "@/components/marketing/decor/SideDecor";
import { Faq } from "@/components/marketing/Faq";
import { PAYMENT_FAQ } from "@/components/marketing/faqData";
import { PricingPlans, SupportBlock, type PlanMascots } from "@/components/marketing/PricingPlans";
import { PricingTable } from "@/components/marketing/PricingTable";
import { PricingViewTracker } from "@/components/marketing/PricingViewTracker";
import { Section } from "@/components/marketing/Section";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { WaitlistRoot } from "@/components/marketing/WaitlistRoot";
import { pageMetadata } from "@/components/marketing/seo";

const TITLE = "Тарифы";
const DESCRIPTION =
  "Game Room бесплатный: комнаты, голос, чат, показ экрана и права хоста. Платные тарифы для хостов и клубов пока только планируются, платить не нужно.";

export const metadata: Metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: "/pricing" });

// Румики на карточках тарифов: «Бесплатно» спокойный, у Pro корона, у клуба компания.
const PLAN_MASCOTS: PlanMascots = {
  free: <Rumik pose="sit" colors={[3, 4, 6, 2]} sticker eyes="wink" size={112} />,
  pro: <Rumik pose="sit" colors={[8, 9, 0, 1]} sticker hat="crown" size={112} />,
  club: (
    <>
      <Rumik pose="sit" colors={[4, 3, 5, 6]} sticker size={90} />
      <Rumik pose="sit" colors={[1, 0, 9, 2]} sticker hat="cap" flip size={90} className="-ml-2.5" />
    </>
  ),
};

// Страница тарифов с заявками («кнопка-проверка спроса»). Платежей в продукте
// нет, поэтому каждый платный тариф честно помечен «Скоро», а кнопка открывает
// форму заявки. Заявки уходят в POST /api/leads, ответ команды — на сайте по
// личной ссылке /request/<id> (А5).
export default function PricingPage() {
  return (
    <WaitlistRoot>
      <DecorWall />
      <PricingViewTracker />
      <main className="flex-1">
        {/* Обёртка во всю ширину и relative: от неё считают позицию украшения по краям. */}
        <div className="relative">
          <div className="mx-auto w-full max-w-[1200px] px-5 pb-14 pt-6 lg:pb-16 lg:pt-14">
            <h1 className="text-balance font-brand text-display text-ink sm:text-hero">Тарифы</h1>
            <p className="mt-5 max-w-[52ch] text-pretty text-body-lg text-ink-2 sm:text-[17px] sm:leading-[1.55]">
              {glueShortWords("Game Room бесплатный, и это не изменится. Платные тарифы для хостов и клубов мы только планируем.")}
            </p>
            <InlineAlert tone="info" title="Тарифы ещё не запущены, платить сейчас не нужно" className="mt-6 max-w-[760px]">
              Напишите нам на сайте, что вам нужно, — ответим здесь же, по вашей личной ссылке.
            </InlineAlert>
            <div className="mt-8 lg:mt-10">
              <PricingPlans mascots={PLAN_MASCOTS} />
            </div>
          </div>
          <SideDecor side="left" top={300}>
            <Rumik pose="cheer" colors={[5, 6, 7, 4]} sticker eyes="wide" />
          </SideDecor>
          <DecorSquare side="left" top={90} inset={50} size={24} color={1} rotate={12} filled />
          <DecorSquare side="right" top={120} inset={40} size={30} color={9} rotate={-10} />
          <DecorSquare side="right" top={520} inset={70} size={20} color={3} rotate={14} filled />
        </div>

        <Section
          id="compare"
          title="Что входит в тариф"
          lead="Всё, что есть сегодня, бесплатно и входит в каждый тариф. Платное только добавляется сверху."
          decor={
            <>
              <SideDecor side="right" sit>
                <Rumik pose="sit" colors={[2, 1, 9, 8]} sticker hat="shades" flip />
              </SideDecor>
              <DecorSquare side="left" top={130} inset={40} size={28} color={4} rotate={-8} />
            </>
          }
        >
          <PricingTable />
          <p className="mt-3 max-w-[70ch] text-caption text-ink-3">
            Состав и цены платных тарифов могут измениться до запуска. Что уже работает, написано в первой группе строк.
          </p>
        </Section>

        <section aria-labelledby="support-title" className="relative border-t border-line">
          <div className="mx-auto w-full max-w-[1200px] px-5 py-14 sm:py-16">
            <SupportBlock />
          </div>
          <DecorSquare side="left" top={70} inset={60} size={22} color={7} rotate={-12} filled />
        </section>

        <Section
          id="payment-faq"
          title="Вопросы про оплату"
          decor={
            <>
              <SideDecor side="left" sit>
                <Rumik pose="sit" colors={[6, 7, 8, 5]} sticker extra="q" look={[2, -2]} />
              </SideDecor>
              <DecorSquare side="right" top={120} inset={50} size={26} color={0} rotate={10} filled />
            </>
          }
        >
          <div className="max-w-[820px]">
            <Faq items={PAYMENT_FAQ} />
          </div>
        </Section>

        <section aria-label="Для клубов" className="relative border-t border-line">
          <div className="mx-auto w-full max-w-[1200px] px-5 py-14 sm:py-16">
            <Card tone="sunken" radius="panel" padding="lg" className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="max-w-[60ch]">
                <h2 className="text-title text-ink">Вы владелец клуба?</h2>
                <p className="mt-1.5 text-pretty text-body-lg text-ink-2">
                  Первый месяц бесплатно: проверим комнаты, голос и показ экрана у вас в зале. Платить не нужно.
                </p>
              </div>
              <Link href="/clubs" className={buttonClass({ variant: "secondary", size: "md", className: "max-sm:w-full" })}>
                Бесплатный пилот
                <Icon name="arrow-right" size={18} className="-mr-1 opacity-70" />
              </Link>
            </Card>
          </div>
        </section>
      </main>
      <SiteFooter />
    </WaitlistRoot>
  );
}

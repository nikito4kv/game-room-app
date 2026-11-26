import type { Metadata } from "next";
import Link from "next/link";
import { assignAvatarColors } from "@/components/ui/avatarColor";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon, type IconName } from "@/components/ui/icons";
import { InlineAlert } from "@/components/ui/InlineAlert";
import { Rumik } from "@/components/ui/Rumik";
import { TablePreview, type TableGuest } from "@/components/ui/TablePreview";
import { glueShortWords } from "@/components/ui/typography";
import { DecorWall } from "@/components/marketing/decor/DecorWall";
import { DecorSquare, SideDecor } from "@/components/marketing/decor/SideDecor";
import { PilotForm } from "@/components/marketing/PilotForm";
import { Section } from "@/components/marketing/Section";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { pageMetadata } from "@/components/marketing/seo";

const TITLE = "Для клубов и киберарен";
const DESCRIPTION =
  "Голосовая комната для гостей компьютерного клуба: без входа в аккаунты на клубных ПК, с рацией и показом экрана. Бесплатный пилот на 30 дней.";

export const metadata: Metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: "/clubs" });

const NAMES = ["Рома", "Кира", "Саня", "Макс", "Влад"];
const COLORS = assignAvatarColors(NAMES);
const TABLE: TableGuest[] = NAMES.map((name, i) => ({
  name,
  colorIndex: COLORS[i],
  host: i === 0,
  speaking: i === 1,
  level: 0.8,
  status: i === 3 ? "ptt" : null,
}));

const PAINS: { icon: IconName; title: string; text: string }[] = [
  {
    icon: "log-in",
    title: "Чужие аккаунты на клубном ПК",
    text: "Гость не хочет вводить на общем компьютере свои логины и пароли. В Game Room входить никуда не нужно: открыл ссылку, выбрал ник.",
  },
  {
    icon: "radio",
    title: "В зале шумно",
    text: "Клавиши, мыши, разговоры за соседними столами. Рация передаёт голос, только пока держишь клавишу, а свой шумодав приглушает ровный фон. Идеальной тишины он не обещает.",
  },
  {
    icon: "users",
    title: "Пятёрка собирается долго",
    text: "Один создаёт комнату, остальные заходят по ссылке или по коду из шести символов. Код можно продиктовать через стол.",
  },
];

const NOW = [
  "Комнаты по ссылке, без регистрации",
  "Голос с шумодавом и рацией",
  "Показ экрана со звуком",
  "Права хоста: кик, бан, замок, пароль",
  "До 10 человек в комнате",
];

const PLANNED = [
  "Название, логотип и цвет клуба на комнате",
  "Несколько залов",
  "Кнопка-ссылка в комнату для сайта клуба",
  "Помощь с запуском",
];

const STEPS = [
  {
    title: "Напишите нам",
    text: "Пара слов о клубе прямо на этой странице. Ответим здесь же, по вашей личной ссылке. Это займёт пару минут.",
  },
  {
    title: "Проверьте связь",
    text: "С клубного компьютера откройте страницу проверки: она покажет, доходят ли голос и показ экрана из вашей сети. Если что-то не так, напишите в переписке по заявке: поможем разобраться.",
  },
  {
    title: "Пробуйте 30 дней",
    text: "Гости заходят в комнаты как обычно. Через месяц обсудим, что получилось и что нужно вашему клубу. Бесплатно, без карты.",
  },
];

// Страница для владельцев клубов и киберарен. Ничего не обещаем сверх того, что
// есть в продукте: брендирование, залы и кнопка для сайта клуба — только «планируется».
export default function ClubsPage() {
  return (
    <>
      <DecorWall />
      <main className="flex-1">
        {/* Обёртка во всю ширину и relative: от неё считают позицию украшения по краям. */}
        <div className="relative">
          <div className="mx-auto grid w-full max-w-[1200px] gap-10 px-5 pb-14 pt-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-14 lg:pb-16 lg:pt-14">
            <section className="flex min-w-0 flex-col items-start">
              <Badge variant="outline" className="mb-5">
                Бесплатный пилот на 30 дней
              </Badge>
              <h1 className="text-balance font-brand text-display text-ink sm:text-hero">
                {glueShortWords("Голос для гостей клуба")}
              </h1>
              <p className="mt-6 max-w-[48ch] text-pretty text-body-lg text-ink-2 sm:text-[17px] sm:leading-[1.55]">
                Гости собирают компанию одной ссылкой, без входа в аккаунты на клубных компьютерах. Первые 30 дней
                бесплатно.
              </p>
              <Link href="#pilot" className={buttonClass({ variant: "primary", size: "lg", className: "mt-8 max-sm:w-full" })}>
                Оставить заявку на пилот
                <Icon name="arrow-right" size={20} className="-mr-1 opacity-70" />
              </Link>
            </section>
            {/* Картинка «пятёрка за столом»: на узком экране её нет, там важнее текст и форма. */}
            <div className="h-[440px] w-full [container-type:size] max-lg:hidden" aria-hidden="true">
              <div className="grid h-full place-items-center">
                <TablePreview people={TABLE} seat="md" />
              </div>
            </div>
          </div>
          <SideDecor side="right" top={420}>
            <Rumik pose="wave" colors={[4, 3, 5, 6]} sticker hat="cap" flip />
          </SideDecor>
          <DecorSquare side="left" top={130} inset={40} size={30} color={6} rotate={10} />
          <DecorSquare side="left" top={380} inset={70} size={20} color={0} rotate={-12} filled />
          <DecorSquare side="right" top={150} inset={50} size={24} color={8} rotate={12} filled />
        </div>

        <Section
          id="pains"
          title="Что мешает гостям сейчас"
          decor={
            <>
              <SideDecor side="left" sit>
                <Rumik pose="sit" colors={[1, 0, 9, 2]} sticker eyes="wide" extra="bang" />
              </SideDecor>
              <DecorSquare side="right" top={110} inset={40} size={28} color={7} rotate={-10} />
            </>
          }
        >
          <ul className="grid gap-8 md:grid-cols-3 md:gap-0 md:divide-x md:divide-line">
            {PAINS.map((p) => (
              <li key={p.title} className="flex flex-col gap-3 md:px-8 md:first:pl-0 md:last:pr-0">
                <span className="grid size-10 place-items-center rounded-control bg-wash-2 text-ink">
                  <Icon name={p.icon} size={20} />
                </span>
                <h3 className="text-title text-ink">{glueShortWords(p.title)}</h3>
                <p className="max-w-[42ch] text-pretty text-body-lg text-ink-2">{glueShortWords(p.text)}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          id="offer"
          title="Что получает клуб"
          lead="Сейчас пилот работает на том, что уже есть в продукте. Остальное мы только планируем."
          decor={
            <>
              <SideDecor side="right" sit>
                <Rumik pose="sit" colors={[5, 4, 3, 6]} sticker hat="crown" flip />
              </SideDecor>
              <DecorSquare side="left" top={140} inset={50} size={26} color={9} rotate={8} filled />
            </>
          }
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <Card padding="lg" className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-title text-ink">Сейчас, в пилоте</h3>
                <Badge variant="soft">Работает сейчас</Badge>
              </div>
              <ul className="flex flex-col gap-2.5">
                {NOW.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-body-lg text-ink-2">
                    <Icon name="check" size={18} className="mt-0.5 shrink-0 text-ink" />
                    {f}
                  </li>
                ))}
              </ul>
            </Card>
            <Card tone="sunken" padding="lg" className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-title text-ink">Планируется</h3>
                <Badge variant="outline">Скоро</Badge>
              </div>
              <ul className="flex flex-col gap-2.5">
                {PLANNED.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-body-lg text-ink-2">
                    <Icon name="history" size={18} className="mt-0.5 shrink-0 text-ink-3" />
                    {f}
                  </li>
                ))}
              </ul>
              <p className="mt-auto border-t border-line pt-4 text-label text-ink-3">
                После пилота: наш план от 990 ₽ в месяц за точку до 15 ПК и 1 990 ₽ до 40 ПК. Цену согласуем до конца
                пилота, за сам пилот вы ничего не платите.
              </p>
            </Card>
          </div>
        </Section>

        <Section
          id="pilot-steps"
          title="Как проходит пилот"
          decor={
            <SideDecor side="left" sit>
              <Rumik pose="sit" colors={[3, 4, 6, 2]} sticker eyes="wink" look={[2, 1]} />
            </SideDecor>
          }
        >
          <ol className="grid gap-8 md:grid-cols-3 md:gap-6">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex flex-col gap-2 border-t border-line-strong pt-5">
                <span aria-hidden="true" className="font-brand text-heading text-ink-3 tabular-nums">
                  {i + 1}
                </span>
                <h3 className="text-title text-ink">{s.title}</h3>
                <p className="max-w-[44ch] text-pretty text-body-lg text-ink-2">{glueShortWords(s.text)}</p>
              </li>
            ))}
          </ol>
          <div className="mt-8">
            <InlineAlert tone="caution" title="Что важно знать до пилота" className="max-w-[860px]">
              <ul className="mt-1 flex list-disc flex-col gap-1.5 pl-5">
                <li>
                  Game Room работает в браузере. Из некоторых сетей связь может не проходить, поэтому мы просим сначала
                  проверить её из вашей сети на странице <Link href="/check" className="text-ink underline underline-offset-4 hover:text-ink-2">проверки связи</Link>.
                </li>
                <li>В одной комнате до 10 человек. Для компании побольше это несколько комнат по 10, а не одна комната на весь зал.</li>
                <li>Показать свой экран можно только с компьютера, а с телефона можно слушать и смотреть.</li>
                <li>Название и логотип клуба, залы и кнопка для сайта пока планируются, в пилоте их нет.</li>
              </ul>
            </InlineAlert>
          </div>
        </Section>

        <Section
          id="pilot"
          title="Заявка на пилот"
          lead="Расскажите о клубе. Ответим здесь же, на сайте: после отправки у вас будет личная ссылка на переписку. Платить не нужно."
          decor={
            <SideDecor side="right" sit>
              <Rumik pose="cheer" colors={[0, 1, 2, 9]} sticker eyes="wide" flip />
            </SideDecor>
          }
        >
          <div className="max-w-[820px]">
            <PilotForm />
          </div>
        </Section>
      </main>
      <SiteFooter />
    </>
  );
}

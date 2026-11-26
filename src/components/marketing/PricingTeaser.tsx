import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/icons";
import { Rumik } from "@/components/ui/Rumik";
import { glueShortWords } from "@/components/ui/typography";
import { DecorSquare, SideDecor } from "./decor/SideDecor";
import { PRICE } from "./plans";
import { Section } from "./Section";

const CELLS = [
  {
    name: "Бесплатно",
    status: "now" as const,
    price: "0 ₽",
    unit: "навсегда",
    text: "Всё, что есть сейчас: комнаты, голос, чат, показ экрана и права хоста.",
  },
  {
    name: "Pro для хоста",
    status: "soon" as const,
    price: PRICE.pro.month,
    unit: "в месяц, план",
    text: "Постоянная комната со своим адресом: ссылка остаётся рабочей, даже когда все вышли.",
  },
  {
    name: "Клуб",
    status: "soon" as const,
    price: `от ${PRICE.clubStart.month}`,
    unit: "в месяц за точку, план",
    text: "Бренд клуба и несколько залов. Первый месяц бесплатно по пилоту.",
  },
];

/** Короткий блок тарифов на главной: три колонки в одной панели и переход на /pricing. */
export function PricingTeaser() {
  return (
    <Section
      id="pricing"
      title="Сколько это стоит"
      lead="Сейчас Game Room бесплатный. Платные тарифы ещё не запущены, платить не нужно."
      decor={
        <>
          <SideDecor side="left" sit>
            <Rumik pose="sit" colors={[2, 1, 9, 8]} sticker hat="crown" look={[2, 0]} />
          </SideDecor>
          <DecorSquare side="right" top={110} inset={40} size={28} color={4} rotate={10} />
        </>
      }
    >
      <Card padding="none" radius="panel" className="overflow-hidden">
        <ul className="grid divide-y divide-line md:grid-cols-3 md:divide-x md:divide-y-0">
          {CELLS.map((c) => (
            <li key={c.name} className="flex flex-col gap-3 p-6">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-title text-ink">{c.name}</h3>
                {c.status === "now" ? (
                  <Badge variant="soft">Работает сейчас</Badge>
                ) : (
                  <Badge variant="outline">Скоро</Badge>
                )}
              </div>
              <p className="flex items-baseline gap-2">
                <span className="font-brand text-heading text-ink tabular-nums">{c.price}</span>
                <span className="text-label text-ink-3">{c.unit}</span>
              </p>
              <p className="max-w-[40ch] text-pretty text-body text-ink-2">{glueShortWords(c.text)}</p>
            </li>
          ))}
        </ul>
      </Card>
      <div className="mt-6">
        <Link href="/pricing" className={buttonClass({ variant: "secondary", size: "md" })}>
          Все тарифы
          <Icon name="arrow-right" size={18} className="-mr-1 opacity-70" />
        </Link>
      </div>
    </Section>
  );
}

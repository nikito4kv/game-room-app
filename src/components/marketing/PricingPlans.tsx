"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClass } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/components/ui/cn";
import { Icon } from "@/components/ui/icons";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { glueShortWords } from "@/components/ui/typography";
import { DECOR_OFF } from "./decor/SideDecor";
import { PLAN_FEATURES, PRICE, YEAR_NOTE, type Period } from "./plans";
import { useWaitlist } from "./WaitlistRoot";

/**
 * Румики на верхнем крае карточек: «Бесплатно», «Pro», «Клуб». Их рисует
 * страница на сервере и передаёт сюда готовыми — так рисунок не попадает в JS
 * клиентского компонента.
 */
export type PlanMascots = Partial<Record<"free" | "pro" | "club", ReactNode>>;

function Features({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((f) => (
        <li key={f} className="flex items-start gap-2.5 text-body text-ink-2">
          <Icon name="check" size={16} className="mt-0.5 shrink-0 text-ink" />
          <span className="text-pretty">{glueShortWords(f)}</span>
        </li>
      ))}
    </ul>
  );
}

function PlanCard({
  name,
  badge,
  blurb,
  price,
  features,
  cta,
  note,
  mascot,
}: {
  name: string;
  badge: ReactNode;
  blurb: string;
  price: ReactNode;
  features: string[];
  cta: ReactNode;
  note?: ReactNode;
  mascot?: ReactNode;
}) {
  return (
    <Card padding="lg" className="relative flex flex-col gap-5">
      {mascot && (
        // Сидит на верхнем крае: низ тела на линии карточки (71,5% высоты рамки
        // Румика), ноги свисают в её отступ и до текста не достают. Только в три
        // колонки: столбиком он сел бы на карточку выше.
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute left-1/2 top-0 hidden w-max -translate-x-1/2 -translate-y-[71.5%] items-end lg:flex",
            DECOR_OFF,
          )}
        >
          {mascot}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-title text-ink">{name}</h3>
          {badge}
        </div>
        <p className="text-pretty text-body text-ink-2 lg:min-h-[60px]">{glueShortWords(blurb)}</p>
      </div>
      <div className="lg:min-h-[64px]">{price}</div>
      <Features items={features} />
      <div className="mt-auto flex flex-col gap-2 pt-2">
        {cta}
        {note && <p className="text-caption text-ink-3">{note}</p>}
      </div>
    </Card>
  );
}

function Price({ value, unit, className }: { value: string; unit: string; className?: string }) {
  return (
    <p className={className ?? "flex items-baseline gap-2"}>
      <span className="font-brand text-display text-ink tabular-nums">{value}</span>
      <span className="text-label text-ink-3">{unit}</span>
    </p>
  );
}

/**
 * Три тарифа и переключатель «в месяц / в год» (годовая скидка есть в сетке:
 * 10 месяцев вместо 12). Платные тарифы помечены «Скоро»; кнопка открывает форму
 * заявки (ответ — на сайте, по личной ссылке), оплаты нет. Бесплатный тариф ведёт в настоящее действие:
 * создать комнату.
 */
export function PricingPlans({ mascots }: { mascots?: PlanMascots }) {
  const { open } = useWaitlist();
  const [period, setPeriod] = useState<Period>("month");
  const unit = period === "month" ? "в месяц" : "в год";

  return (
    // С Румиками над карточками нужен воздух: они поднимаются над краем на 67 px.
    <div className={cn("flex flex-col gap-6", mascots && "lg:gap-[72px] [:root[data-decor=off]_&]:lg:gap-6")}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <SegmentedControl
          label="Период оплаты"
          value={period}
          onValueChange={setPeriod}
          options={[
            { value: "month", label: "В месяц" },
            { value: "year", label: "В год" },
          ]}
        />
        <p className="text-label text-ink-3">
          {period === "year" ? `Год: ${YEAR_NOTE}. Это план, оплаты пока нет.` : "Цены платных тарифов: наш план."}
        </p>
      </div>

      <div className="grid items-stretch gap-4 lg:grid-cols-3">
        <PlanCard
          name="Бесплатно"
          badge={<Badge variant="soft">Работает сейчас</Badge>}
          blurb="Всё, что есть в Game Room сегодня. Платить не нужно."
          price={<Price value="0 ₽" unit="навсегда" />}
          features={PLAN_FEATURES.free}
          mascot={mascots?.free}
          cta={
            <Link href="/#create" className={buttonClass({ variant: "primary", size: "lg", block: true })}>
              <Icon name="plus" size={20} className="-ml-0.5" />
              Создать комнату
            </Link>
          }
        />

        <PlanCard
          name="Pro для хоста"
          badge={<Badge variant="outline">Скоро</Badge>}
          blurb="Сейчас комната и ссылка живут недолго после ухода последнего. В Pro комната остаётся на месте."
          price={<Price value={PRICE.pro[period]} unit={unit} />}
          features={PLAN_FEATURES.pro}
          mascot={mascots?.pro}
          cta={
            <Button variant="secondary" size="lg" block onClick={() => open("pro")}>
              Написать нам
            </Button>
          }
          note="Тариф не запущен, платить сейчас не нужно. Когда запустим, планируем 14 дней пробно без карты."
        />

        <PlanCard
          name="Клуб"
          badge={<Badge variant="outline">Скоро</Badge>}
          blurb="Для компьютерных клубов и киберарен. Цена за точку."
          price={
            <dl className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-label text-ink-3">до 15 ПК</dt>
                <dd className="font-brand text-title text-ink tabular-nums">
                  {PRICE.clubStart[period]} <span className="font-body text-label font-normal text-ink-3">{unit}</span>
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-label text-ink-3">до 40 ПК</dt>
                <dd className="font-brand text-title text-ink tabular-nums">
                  {PRICE.club[period]} <span className="font-body text-label font-normal text-ink-3">{unit}</span>
                </dd>
              </div>
            </dl>
          }
          features={PLAN_FEATURES.club}
          mascot={mascots?.club}
          cta={
            <>
              <Button variant="secondary" size="lg" block onClick={() => open("club")}>
                Написать нам
              </Button>
              <Link href="/clubs" className={buttonClass({ variant: "ghost", size: "md", block: true })}>
                Бесплатный пилот на 30 дней
                <Icon name="arrow-right" size={18} className="-mr-1 opacity-70" />
              </Link>
            </>
          }
          note="Тариф не запущен, платить сейчас не нужно. Первый месяц бесплатно по пилоту."
        />
      </div>
    </div>
  );
}

/** Блок «Хочу поддержать»: та же заявка, продукт «support». Реальной оплаты нет. */
export function SupportBlock() {
  const { open } = useWaitlist();
  return (
    <Card tone="ghost" padding="lg" radius="panel" className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="max-w-[60ch]">
        <h2 id="support-title" className="font-brand text-heading text-ink">
          Хочу поддержать проект
        </h2>
        <p className="mt-2 text-pretty text-body-lg text-ink-2">
          Если Game Room вам нравится и хочется помочь, напишите нам на сайте. Способа поддержать пока нет: когда он
          появится, ответим здесь же. Новых функций за это не обещаем.
        </p>
      </div>
      <Button variant="secondary" size="md" onClick={() => open("support")} className="max-sm:w-full">
        Хочу поддержать
      </Button>
    </Card>
  );
}

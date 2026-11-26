import Link from "next/link";
import { buttonClass } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/icons";
import { Rumik } from "@/components/ui/Rumik";
import { cn } from "@/components/ui/cn";
import { glueShortWords } from "@/components/ui/typography";
import { DECOR_OFF, DecorSquare } from "./decor/SideDecor";

/**
 * Финальный призыв главной. Кнопки ведут к карточкам героя (#create, #join):
 * страница одна, повторять форму ниже незачем. На широком экране над краем
 * карточки радуются двое Румиков (украшение, от 1280 px).
 */
export function FinalCta() {
  return (
    <section aria-labelledby="final-title" className="relative border-t border-line">
      <div className="mx-auto w-full max-w-[1200px] px-5 py-14 sm:py-16 lg:py-20 xl:pt-[88px]">
        <Card
          tone="raised"
          radius="panel"
          padding="lg"
          className="relative flex flex-col gap-6 sm:p-10 lg:flex-row lg:items-center lg:justify-between"
        >
          <div className="max-w-[560px]">
            <h2 id="final-title" className="text-balance font-brand text-heading text-ink sm:text-display">
              {glueShortWords("Создайте комнату и позовите друзей")}
            </h2>
            <p className="mt-3 text-pretty text-body-lg text-ink-2 sm:text-[17px] sm:leading-[1.55]">
              Бесплатно, без регистрации, прямо в браузере.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row lg:shrink-0">
            <Link href="/#create" className={buttonClass({ variant: "primary", size: "lg", className: "max-sm:w-full" })}>
              <Icon name="plus" size={20} className="-ml-0.5" />
              Создать комнату
            </Link>
            <Link href="/#join" className={buttonClass({ variant: "secondary", size: "lg", className: "max-sm:w-full" })}>
              Войти по коду
            </Link>
          </div>
          <div
            aria-hidden="true"
            className={cn("pointer-events-none absolute -top-[86px] right-7 hidden w-[250px] xl:flex", DECOR_OFF)}
          >
            <Rumik pose="cheer" colors={[0, 1, 2, 9]} sticker eyes="wide" size={125} />
            <Rumik pose="cheer" colors={[8, 7, 6, 5]} sticker eyes="wide" flip size={125} className="-ml-3.5" />
          </div>
        </Card>
      </div>
      <DecorSquare side="left" top={130} inset={40} size={30} color={3} rotate={10} />
      <DecorSquare side="right" top={180} inset={50} size={26} color={0} rotate={-12} filled />
    </section>
  );
}

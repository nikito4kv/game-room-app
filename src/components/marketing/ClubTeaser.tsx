import Link from "next/link";
import { buttonClass } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon, type IconName } from "@/components/ui/icons";
import { Rumik } from "@/components/ui/Rumik";
import { glueShortWords } from "@/components/ui/typography";
import { DecorSquare, SideDecor } from "./decor/SideDecor";
import { Section } from "./Section";

const POINTS: { icon: IconName; title: string; text: string }[] = [
  {
    icon: "log-in",
    title: "Без входа в аккаунты",
    text: "Ссылка открывается сразу. Не нужно вводить на клубном компьютере свои логины и пароли.",
  },
  {
    icon: "radio",
    title: "Рация для шумного места",
    text: "Включите рацию, и микрофон передаёт звук, только пока вы держите клавишу. Свой шумодав тоже внутри, но идеальной тишины он не обещает.",
  },
  {
    icon: "users",
    title: "Быстро собрать пятёрку",
    text: "Код из шести символов легко продиктовать соседу через стол, а ссылку можно скинуть в любой чат.",
  },
];

/** «Играете из клуба?»: для гостей клуба, плюс отдельная плитка для владельцев. */
export function ClubTeaser() {
  return (
    <Section
      id="club"
      title="Играете из клуба?"
      lead="Комната открывается в браузере на клубном компьютере. Входить в свои аккаунты для этого не нужно."
      decor={
        <>
          <SideDecor side="right" sit>
            <Rumik pose="sit" colors={[0, 1, 2, 9]} sticker hat="cap" flip look={[-2, 0]} />
          </SideDecor>
          <DecorSquare side="left" top={150} inset={30} size={30} color={7} rotate={-8} />
          <DecorSquare side="left" top={360} inset={70} size={18} color={3} rotate={12} filled />
        </>
      }
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-14">
        <div>
          <ul className="flex flex-col gap-6">
            {POINTS.map((p) => (
              <li key={p.title} className="flex gap-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-control bg-wash-2 text-ink">
                  <Icon name={p.icon} size={20} />
                </span>
                <div className="min-w-0">
                  <h3 className="text-title text-ink">{glueShortWords(p.title)}</h3>
                  <p className="mt-1 max-w-[56ch] text-pretty text-body-lg text-ink-2">{glueShortWords(p.text)}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-6 max-w-[60ch] text-label text-ink-3">
            Создавали комнату на клубном компьютере? Заходите из окна инкогнито: ключ хоста хранится в браузере, и там
            он не останется.
          </p>
        </div>

        <Card tone="sunken" padding="lg" radius="panel" className="flex h-fit flex-col items-start gap-3">
          <h3 className="text-title text-ink">Вы владелец клуба?</h3>
          <p className="text-pretty text-body-lg text-ink-2">
            Ищем клубы для бесплатного пилота на 30 дней: комнаты, голос и показ экрана для ваших гостей.
          </p>
          <Link href="/clubs" className={buttonClass({ variant: "secondary", size: "md", className: "mt-2" })}>
            Узнать про пилот
            <Icon name="arrow-right" size={18} className="-mr-1 opacity-70" />
          </Link>
        </Card>
      </div>
    </Section>
  );
}

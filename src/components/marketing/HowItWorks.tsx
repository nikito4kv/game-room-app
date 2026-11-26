import { Icon, type IconName } from "@/components/ui/icons";
import { Rumik, type RumikProps } from "@/components/ui/Rumik";
import { cn } from "@/components/ui/cn";
import { glueShortWords } from "@/components/ui/typography";
import { DECOR_OFF, DecorSquare, SideDecor } from "./decor/SideDecor";
import { Section } from "./Section";

// Компания в шаге 3: первый говорит (лаймовая обводка), двое слушают.
const PEOPLE: RumikProps[] = [
  { colors: [6, 5, 4, 2], glow: true },
  { colors: [2, 1, 0, 9], sticker: true },
  { colors: [4, 3, 5, 6], sticker: true, eyes: "wink" },
];

type Step = { icon: IconName; title: string; text: string; extra?: "code" | "people" };

const STEPS: Step[] = [
  {
    icon: "plus",
    title: "Создайте комнату",
    text: "Нажмите «Создать комнату». Название и пароль по желанию, ник у вас спросят при входе.",
  },
  {
    icon: "link",
    title: "Отправьте ссылку",
    text: "Скиньте друзьям ссылку или код из шести символов туда, где вы обычно общаетесь.",
    extra: "code",
  },
  {
    icon: "mic",
    title: "Слышите друг друга",
    text: "Друзья открывают ссылку в браузере и входят без регистрации. Разрешите микрофон, и вы на связи.",
    extra: "people",
  },
];

/** «Как это работает»: три шага без карточек, их соединяет тонкая линия. */
export function HowItWorks() {
  return (
    <Section
      id="how"
      title="Как это работает"
      decor={
        <>
          <SideDecor side="right" sit>
            <Rumik pose="sit" colors={[8, 9, 0, 1]} sticker hat="beanie" eyes="wink" flip />
          </SideDecor>
          <DecorSquare side="left" top={120} inset={40} size={26} color={6} rotate={10} />
          <DecorSquare side="right" top={300} inset={70} size={20} color={2} rotate={-12} filled />
        </>
      }
    >
      <ol className="grid gap-9 md:grid-cols-3 md:gap-6">
        {STEPS.map((step) => (
          <li
            key={step.title}
            className="relative md:[&:not(:last-child)]:after:absolute md:[&:not(:last-child)]:after:-right-3 md:[&:not(:last-child)]:after:left-[3.5rem] md:[&:not(:last-child)]:after:top-[22px] md:[&:not(:last-child)]:after:h-px md:[&:not(:last-child)]:after:bg-line md:[&:not(:last-child)]:after:content-['']"
          >
            <span className="grid size-11 place-items-center rounded-control border border-line-strong bg-raised text-ink">
              <Icon name={step.icon} size={20} />
            </span>
            <h3 className="mt-4 text-title text-ink">{step.title}</h3>
            <p className="mt-1.5 max-w-[36ch] text-pretty text-body-lg text-ink-2">{glueShortWords(step.text)}</p>
            {step.extra === "code" && (
              <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="rounded-control border border-line bg-sunken px-3 py-1.5 font-brand text-label tracking-[0.16em] text-ink">
                  K7QMP4
                </span>
                <span className="text-caption text-ink-3">так выглядит код комнаты</span>
              </p>
            )}
            {step.extra === "people" && (
              // Флаг rumik_decor выключен — картинки нет, шаг остаётся текстом.
              <div
                className={cn("mt-3.5 flex items-end gap-1.5", DECOR_OFF)}
                role="img"
                aria-label="Тёма говорит, Ника и Лёха слушают"
              >
                {PEOPLE.map((p, i) => (
                  <Rumik key={i} {...p} size={64} />
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
    </Section>
  );
}

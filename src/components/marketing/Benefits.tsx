import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card, type CardTone } from "@/components/ui/Card";
import { Icon, type IconName } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/Kbd";
import { LevelMeter } from "@/components/ui/LevelMeter";
import { Rumik } from "@/components/ui/Rumik";
import { cn } from "@/components/ui/cn";
import { glueShortWords } from "@/components/ui/typography";
import { DecorSquare, SideDecor } from "./decor/SideDecor";
import { Section } from "./Section";
import { VolumeDemo } from "./VolumeDemo";

function Tile({
  icon,
  title,
  tone = "raised",
  className,
  children,
  visual,
}: {
  icon: IconName;
  title: string;
  tone?: CardTone;
  className?: string;
  children: string;
  visual?: ReactNode;
}) {
  return (
    <Card tone={tone} padding="lg" className={cn("flex flex-col", className)}>
      <span className="grid size-10 place-items-center rounded-control bg-wash-2 text-ink">
        <Icon name={icon} size={20} />
      </span>
      <h3 className="mt-4 text-title text-ink">{glueShortWords(title)}</h3>
      <p className="mt-1.5 max-w-[52ch] text-pretty text-body-lg text-ink-2">{glueShortWords(children)}</p>
      {visual && <div className="mt-auto pt-5">{visual}</div>}
    </Card>
  );
}

const PROFILES = ["720p · 60", "1080p · 60", "1440p · 60", "Текст"];
const HOST_POWERS = ["Выгнать", "Забанить", "Заглушить всех", "Пароль", "Закрыть вход"];

/**
 * «Почему удобно играть»: только то, что уже есть в продукте. Сетка плиток
 * разного размера, без трёх одинаковых карточек. В плитках — настоящие
 * примитивы (полоса уровня, ползунок), а не нарисованные картинки.
 */
export function Benefits() {
  return (
    <Section
      id="why"
      title="Почему удобно играть"
      lead="Мы делали комнату для вечера за игрой, а не для рабочей встречи. Всё, что здесь написано, уже работает."
      decor={
        <>
          <SideDecor side="left" sit>
            <Rumik pose="sit" colors={[4, 3, 5, 6]} sticker hat="shades" />
          </SideDecor>
          <DecorSquare side="right" top={90} inset={30} size={34} color={9} rotate={14} />
          <DecorSquare side="left" top={420} inset={50} size={20} color={1} rotate={-10} filled />
          <DecorSquare side="right" top={900} inset={60} size={24} color={5} rotate={8} />
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
        <Tile
          icon="screen-share"
          title="Показ экрана со звуком"
          className="md:col-span-2 lg:col-span-4"
          visual={
            <div>
              <ul className="flex flex-wrap gap-2" aria-label="Режимы показа экрана">
                {PROFILES.map((p) => (
                  <li key={p}>
                    <Badge variant="outline" size="md">
                      {p}
                    </Badge>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-caption text-ink-3">Качество зависит от вашего интернета и компьютера.</p>
            </div>
          }
        >
          Покажите друзьям игру или фильм: до 1080p и 60 кадров в секунду, звук идёт вместе с картинкой. Для кода и
          документов есть режим «Текст».
        </Tile>

        <Tile
          icon="audio-lines"
          title="Свой шумодав"
          className="lg:col-span-2"
          visual={
            <div>
              <LevelMeter
                levelDb={-27}
                thresholdDb={-44}
                mode="auto"
                size="sm"
                label="Пример: уровень голоса и порог шумодава"
              />
              <p className="mt-2 text-caption text-ink-3">Всё, что тише порога, не уходит в эфир.</p>
            </div>
          }
        >
          Приглушает клавиши, вентиляторы и ровный фон. Порог подстраивается сам, есть калибровка.
        </Tile>

        <Tile icon="users" title="Громкость каждого друга" tone="ghost" className="lg:col-span-2" visual={<VolumeDemo />}>
          Тихого сделайте громче, громкого тише. До 200%, и только у вас.
        </Tile>

        <Tile
          icon="radio"
          title="Рация"
          tone="ghost"
          className="lg:col-span-2"
          visual={
            <p className="flex items-center gap-2 text-label text-ink-2">
              <Kbd>V</Kbd>
              <span>держите, пока говорите</span>
            </p>
          }
        >
          Говорите, пока держите клавишу. Удобно, когда рядом шумно или не хочется быть в эфире всё время.
        </Tile>

        <Tile icon="pip" title="Мини-окно поверх игры" tone="ghost" className="lg:col-span-2">
          Кто говорит и кнопка микрофона в маленьком окне, которое лежит поверх других. Работает в Chrome и Edge.
        </Tile>

        <Tile
          icon="crown"
          title="Права хоста"
          className="lg:col-span-3"
          visual={
            <ul className="flex flex-wrap gap-2" aria-label="Что может хост">
              {HOST_POWERS.map((p) => (
                <li key={p}>
                  <Badge>{p}</Badge>
                </li>
              ))}
            </ul>
          }
        >
          Хост решает, кто остаётся, кто показывает экран и пишет в чат. Эти права проверяет сервер, а не только
          кнопки в интерфейсе.
        </Tile>

        <Tile icon="log-in" title="Без регистрации" tone="sunken" className="lg:col-span-3">
          Ни аккаунта, ни почты, ни установки. Ссылка открывается в браузере, ник вы выбираете при входе.
        </Tile>
      </div>
    </Section>
  );
}

// Витрина Румика для разработчиков: позы, глаза-сигналы, шапки, значки, цвета,
// размеры, рисунок на Румике, головы, жесты реакций, песочница и правила декора.
// Правила — DESIGN_SYSTEM.md §8 «Бренд-слой». Серверный компонент: Румик без JS,
// интерактивна только песочница.

import Link from "next/link";
import type { ReactNode } from "react";
import { REACTION_GESTURES, REACTION_VIEW } from "@/app/room/[code]/reactions/gesture";
import { Section as SiteSection } from "@/components/marketing/Section";
import { DecorSquare, SideDecor } from "@/components/marketing/decor/SideDecor";
import {
  AvatarStack,
  Card,
  Icon,
  Logo,
  Rumik,
  UiRoot,
  buttonClass,
  type AvatarSize,
  type AvatarStatus,
  type RumikColors,
  type RumikExtra,
  type RumikEyes,
  type RumikHat,
  type RumikPose,
} from "@/components/ui";
import { RumikAvatar } from "@/components/ui/Avatar";
import { SEAT_FRAME_CLASS, SEAT_HEAD_STYLE } from "@/components/ui/TablePreview";
import { REACTION_KINDS } from "@/lib/api/contract";
import { PEOPLE } from "./data";
import { RumikPlayground, type PlaygroundOptions } from "./RumikPlayground";
import { ReactionBubbleSample, SAMPLE_PAINT } from "./rumikSamples";

const POSES: { value: RumikPose; label: string }[] = [
  { value: "stand", label: "стоит" },
  { value: "wave", label: "машет (рука справа)" },
  { value: "waveL", label: "машет (рука слева)" },
  { value: "cheer", label: "радуется: обе руки вверх" },
  { value: "point", label: "показывает в сторону" },
  { value: "sit", label: "сидит на линии секции" },
  { value: "hold", label: "держит перед собой" },
  { value: "laugh", label: "смеётся: держится за живот (жест 😂)" },
];

const EYES: { value: RumikEyes; label: string; note: string }[] = [
  { value: "normal", label: "обычные", note: "Кольцо слушает, лаймовый круг говорит: две «о» из логотипа. По умолчанию." },
  { value: "wink", label: "подмигивает", note: "Всё хорошо, заходи. «Вы вышли», приглашения." },
  { value: "sleep", label: "спит", note: "Нет активности, тихо. «Открытых комнат нет»." },
  { value: "wide", label: "удивлён", note: "Что-то не по плану. «Комната заполнена», «Что-то пошло не так»." },
  { value: "muted", label: "микрофон выключен", note: "Кольцо перечёркнуто красным, как значок мьюта." },
  { value: "lost", label: "связь потеряна", note: "Крестик вместо кольца. Только «Связь потеряна»." },
  { value: "speak", label: "говорит", note: "Лаймовый круг крупнее. Для картинок; индикатор «говорит» — glow." },
];

const HATS: { value: RumikHat; label: string }[] = [
  { value: "cap", label: "кепка" },
  { value: "beanie", label: "вязаная шапка" },
  { value: "crown", label: "корона: хост или Pro (цвет crown)" },
  { value: "shades", label: "тёмные очки" },
];

const EXTRAS: { value: RumikExtra; label: string }[] = [
  { value: "q", label: "«?» вопрос: 404, частые вопросы" },
  { value: "bang", label: "«!» внимание: обрыв, ошибка" },
  { value: "zzz", label: "«Zz» спит: пара к глазам sleep" },
];

/** Имена палитры аватаров — как в tokens.css. */
const COLOR_NAMES = ["коралл", "абрикос", "песок", "мята", "бирюза", "лазурь", "небо", "барвинок", "сирень", "фуксия"];

const QUADS: { colors: RumikColors; code: string }[] = [
  { colors: [6, 5, 4, 2], code: "[6, 5, 4, 2]" },
  { colors: [8, 9, 0, 1], code: "[8, 9, 0, 1]" },
  { colors: [1, 0, 9, 2], code: "[1, 0, 9, 2]" },
  { colors: [4, 3, 5, 6], code: "[4, 3, 5, 6]" },
];

const SIZES = [24, 32, 48, 64, 96, 160];

const HEAD_SIZES: AvatarSize[] = ["xs", "sm", "md", "lg", "xl"];

/** Состояния головы — как у места в комнате (seatStatus). */
const HEAD_STATES: { label: string; speaking?: boolean; status?: AvatarStatus; paint?: boolean }[] = [
  { label: "тишина" },
  { label: "говорит", speaking: true },
  { label: "мьют", status: "muted" },
  { label: "звук выкл", status: "deafened" },
  { label: "заглушён хостом", status: "forceMuted" },
  { label: "рация", status: "ptt" },
  { label: "рисунок, говорит", speaking: true, paint: true },
];

const PLAYGROUND: PlaygroundOptions = {
  poses: POSES,
  eyes: EYES.map(({ value, label }) => ({ value, label })),
  hats: HATS,
  extras: EXTRAS,
  colorNames: COLOR_NAMES,
};

/* ------------------------------------------------------------- Каркас */

function Block({ id, title, lead, children }: { id: string; title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 border-t border-line py-12">
      <h2 id={`${id}-title`} className="font-brand text-heading text-ink">
        {title}
      </h2>
      {lead && <p className="mt-2 max-w-[70ch] text-pretty text-body text-ink-2">{lead}</p>}
      <div className="mt-6 flex flex-col gap-8">{children}</div>
    </section>
  );
}

/** Плитка: Румик сверху, под ним код и смысл. Румик тянется по ширине, но не больше max. */
function Tile({ code, note, max = 128, children }: { code: string; note?: ReactNode; max?: number; children: ReactNode }) {
  return (
    <figure className="flex flex-col items-center gap-3 rounded-card border border-line px-3 pb-4 pt-6 text-center">
      <div className="flex w-full justify-center">
        <div className="w-full" style={{ maxWidth: max }}>
          {children}
        </div>
      </div>
      <figcaption className="flex flex-col gap-0.5">
        <code className="font-code text-label text-ink">{code}</code>
        {note && <span className="text-pretty text-caption text-ink-3">{note}</span>}
      </figcaption>
    </figure>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <code className="font-code text-[0.92em] text-ink">{children}</code>;
}

/* ------------------------------------------------------------ Витрина */

export function RumikShowcase({ theme }: { theme?: "dark" | "light" }) {
  const otherTheme = theme === "light" ? "/design/rumik" : "/design/rumik?theme=light";
  return (
    <UiRoot theme={theme} className="fixed inset-0 overflow-y-auto">
      <header className="sticky top-0 z-[var(--gr-z-sticky)] border-b border-line bg-canvas">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-3 px-5">
          <Link href="/design" className="shrink-0" aria-label="Витрина дизайн-системы">
            <Logo variant="lockup" height={24} className="text-ink" />
          </Link>
          <span className="text-label text-ink-3 max-sm:hidden">Румик · бренд-слой</span>
          <div className="ml-auto flex items-center gap-1">
            <Link href="/design/editor" className={buttonClass({ variant: "ghost", size: "sm", className: "max-sm:hidden" })}>
              <Icon name="brush" size={16} />
              Рисовалка
            </Link>
            <Link href={otherTheme} className={buttonClass({ variant: "ghost", size: "sm" })}>
              <Icon name={theme === "light" ? "moon" : "sun"} size={16} />
              {theme === "light" ? "Тёмная" : "Светлая"}
            </Link>
            <Link href="/design" className={buttonClass({ variant: "ghost", size: "sm" })}>
              Все примитивы
            </Link>
          </div>
        </div>
      </header>

      <main>
        <div className="mx-auto max-w-[1200px] px-5">
          <div className="grid items-center gap-8 py-12 md:grid-cols-[minmax(0,1fr)_280px]">
            <div className="min-w-0">
              <h1 className="font-brand text-display text-ink">Румик</h1>
              <p className="mt-3 max-w-[60ch] text-pretty text-body-lg text-ink-2">
                Маскот Game Room. На витрине он украшение, в комнате — сам человек: место за столом и голова в списке, со
                своим рисунком. Один SVG: поза, глаза, шапка, значок и цвета задаются параметрами, цвета только из
                токенов, светлая тема перекрашивает его сама. Где можно и где нельзя — внизу страницы и в{" "}
                <Code>DESIGN_SYSTEM.md</Code> §8.
              </p>
              <pre className="mt-5 overflow-x-auto rounded-card border border-line bg-sunken px-4 py-3 font-code text-label text-ink-2">
                {`import { Rumik } from "@/components/ui/Rumik";\n\n<Rumik colors={[6, 5, 4, 2]} pose="wave" hat="cap" sticker />`}
              </pre>
            </div>
            <div className="mx-auto w-full max-w-[180px] md:max-w-[240px]">
              <Rumik colors={[6, 5, 4, 2]} pose="wave" hat="cap" sticker look={[-2, 0]} label="Румик машет рукой" />
            </div>
          </div>

          <Block id="poses" title="Позы" lead={<>Восемь поз, проп <Code>pose</Code>. Руки и ноги — монолиния с круглыми концами, как штрихи логотипа.</>}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              {POSES.map((p) => (
                <Tile key={p.value} code={p.value} note={p.label}>
                  <Rumik pose={p.value} colors={[6, 5, 4, 2]} sticker />
                </Tile>
              ))}
            </div>
          </Block>

          <Block
            id="eyes"
            title="Глаза = сигналы продукта"
            lead={
              <>
                Глаза говорят на том же языке, что значки в комнате: кольцо слушает, лаймовый круг говорит, красная черта —
                микрофон выключен. Проп <Code>eyes</Code>. Глаз со смыслом не ставим «для красоты»: <Code>muted</Code> и{" "}
                <Code>lost</Code> — только там, где это правда.
              </>
            }
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {EYES.map((e) => (
                <Tile
                  key={e.value}
                  code={e.value}
                  max={170}
                  note={
                    <>
                      <span className="block font-semibold text-ink-2">{e.label}</span>
                      {e.note}
                    </>
                  }
                >
                  <Rumik colors={4} eyes={e.value} />
                </Tile>
              ))}
            </div>
          </Block>

          <Block id="hats" title="Шапки и значки" lead={<>Проп <Code>hat</Code> — головной убор, <Code>extra</Code> — значок у головы. Значки не отражаются вместе с фигурой: при <Code>flip</Code> «?» читается.</>}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {HATS.map((h) => (
                <Tile key={h.value} code={`hat="${h.value}"`} note={h.label}>
                  <Rumik colors={[1, 0, 9, 2]} hat={h.value} sticker />
                </Tile>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {EXTRAS.map((x) => (
                <Tile key={x.value} code={`extra="${x.value}"`} note={x.label}>
                  <Rumik
                    colors={[8, 7, 6, 5]}
                    extra={x.value}
                    eyes={x.value === "zzz" ? "sleep" : "normal"}
                    sticker
                  />
                </Tile>
              ))}
            </div>
          </Block>

          <Block
            id="colors"
            title="Цвета"
            lead={
              <>
                Тело — палитра аватаров: один индекс 0–9, до четырёх по четвертям (верх-слева, верх-справа, низ-справа,
                низ-слева; ноги и руки берут нижние четверти, кисти — верхние) или <Code>&quot;white&quot;</Code>. Лицо всегда на
                тёмной плашке <Code>--gr-avatar-ink</Code>, поэтому глаза читаются на любом цвете и в любой теме.
              </>
            }
          >
            <div className="flex flex-col gap-3">
              <p className="text-label text-ink-3">
                Один цвет: <Code>colors={"{6}"}</Code>
              </p>
              <div className="grid grid-cols-5 gap-2 lg:grid-cols-10">
                {COLOR_NAMES.map((name, i) => (
                  <figure key={name} className="flex flex-col items-center gap-1.5">
                    <div className="w-full max-w-[96px]">
                      <Rumik colors={i} />
                    </div>
                    <figcaption className="text-center text-caption text-ink-3">
                      <span className="font-code text-ink-2">{i}</span> {name}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {QUADS.map((q) => (
                <Tile key={q.code} code={q.code} note="по четвертям">
                  <Rumik colors={q.colors} sticker />
                </Tile>
              ))}
              <Tile code={`"white"`} note="некрашеный: заготовка для рисовалки">
                <Rumik colors="white" />
              </Tile>
              <Tile code={`"white" sticker`} note="с наклейкой">
                <Rumik colors="white" sticker />
              </Tile>
            </div>
            <div className="flex flex-col gap-3">
              <p className="text-label text-ink-3">
                <Code>sticker</Code> — белый край наклейки. Отделяет фигуру от фона: на витрине и в декоре — с ним, в
                пустых состояниях — по месту.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex items-end justify-center gap-6 rounded-card border border-line bg-canvas px-4 pb-4 pt-6">
                  <Rumik colors={[4, 3, 5, 6]} size={96} />
                  <Rumik colors={[4, 3, 5, 6]} size={96} sticker />
                </div>
                <Card className="flex items-end justify-center gap-6 pt-6">
                  <Rumik colors={[0, 1, 2, 9]} size={96} />
                  <Rumik colors={[0, 1, 2, 9]} size={96} sticker />
                </Card>
                <Card tone="sunken" className="flex items-end justify-center gap-6 pt-6">
                  <Rumik colors={[7, 8, 9, 6]} size={96} />
                  <Rumik colors={[7, 8, 9, 6]} size={96} sticker />
                </Card>
              </div>
              <p className="text-caption text-ink-3">Слева направо: фон canvas, карточка raised, колодец sunken. В каждой паре без наклейки и с ней.</p>
            </div>
          </Block>

          <Block
            id="motion"
            title="«Говорит», взгляд, наклон, отражение"
            lead={
              <>
                Всё статично: Румик не анимируется. <Code>glow</Code> — индикатор «говорит» (тонкая лаймовая обводка по
                силуэту и мягкое свечение; за столом к нему ещё значок с полосками у головы); <Code>flip</Code> — смотрит
                в другую сторону; <Code>tilt</Code> — наклон до ±15°; <Code>look</Code> — взгляд, сдвиг до ±4 (за столом
                все смотрят к центру).
              </>
            }
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile code="glow" note="говорит">
                <Rumik colors={[6, 5, 4, 2]} glow />
              </Tile>
              <Tile code={`glow sticker`} note="говорит: glow важнее наклейки">
                <Rumik colors={[6, 5, 4, 2]} glow sticker pose="wave" />
              </Tile>
              <Tile code={`extra="q"`} note="без flip">
                <Rumik colors={[5, 6, 7, 4]} pose="point" extra="q" sticker />
              </Tile>
              <Tile code={`flip extra="q"`} note="отражён, «?» читается">
                <Rumik colors={[5, 6, 7, 4]} pose="point" extra="q" sticker flip />
              </Tile>
            </div>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
              {[-15, -6, 0, 6, 15].map((t) => (
                <Tile key={t} code={`tilt={${t}}`}>
                  <Rumik colors={2} tilt={t} />
                </Tile>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {(
                [
                  [-4, 0],
                  [4, 0],
                  [0, -4],
                  [0, 4],
                  [3, -2],
                ] as const
              ).map((l) => (
                <Tile key={l.join()} code={`look={[${l[0]}, ${l[1]}]}`} max={110}>
                  <Rumik colors={9} look={l} />
                </Tile>
              ))}
            </div>
          </Block>

          <Block
            id="sizes"
            title="Размеры"
            lead={
              <>
                Проп <Code>size</Code> — ширина в px, без него Румик во всю ширину контейнера (пропорция 286×240). От 48 px
                читаются глаза и шапка; 24–32 — только силуэт и цвет: значки и глаза со смыслом там не ставим.
              </>
            }
          >
            <div className="flex flex-col gap-6">
              {[false, true].map((sticker) => (
                <div key={String(sticker)} className="flex flex-wrap items-end gap-x-8 gap-y-6">
                  {SIZES.map((s) => (
                    <figure key={s} className="flex flex-col items-center gap-2">
                      <Rumik colors={[6, 5, 4, 2]} hat="cap" size={s} sticker={sticker} />
                      <figcaption className="font-code text-caption text-ink-3">
                        {s}
                        {sticker ? " sticker" : ""}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              ))}
            </div>
          </Block>

          <Block
            id="paint"
            title="Рисунок на Румике"
            lead={
              <>
                Проп <Code>paint</Code> — рисунок человека из рисовалки: PNG слоя краски в рамке 286×240 (или 572×480),
                нарисованный на стоящем Румике. Он ложится по частям тела, и в других позах рукава, перчатки и кеды едут
                вместе с руками и ногами. Половина руки, спрятанная в позе «стоит» за телом, закрашивается отражением
                видимой — у плеча нет клина цвета туловища. Под рисунком — <Code>colors=&quot;white&quot;</Code>. Лицо,
                глаза, шапка и обводка рисуются поверх, поэтому <Code>glow</Code> и <Code>eyes=&quot;muted&quot;</Code> видны
                и на рисунке.
              </>
            }
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              {POSES.map((p) => (
                <Tile key={p.value} code={p.value} note={p.label}>
                  <Rumik pose={p.value} colors="white" paint={SAMPLE_PAINT} />
                </Tile>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile code="glow" note="говорит: обводка и свечение поверх рисунка">
                <Rumik colors="white" paint={SAMPLE_PAINT} glow />
              </Tile>
              <Tile code={`eyes="muted"`} note="мьют виден и на рисунке">
                <Rumik colors="white" paint={SAMPLE_PAINT} eyes="muted" />
              </Tile>
              <Tile code={`hat="cap" flip sticker`} note="шапка поверх, отражение">
                <Rumik colors="white" paint={SAMPLE_PAINT} pose="wave" hat="cap" flip sticker />
              </Tile>
              <Tile code={`colors="white"`} note="тот же Румик без рисунка">
                <Rumik colors="white" />
              </Tile>
            </div>
            <pre className="overflow-x-auto rounded-card border border-line bg-sunken px-4 py-3 font-code text-label text-ink-2">
              {`// Свой рисунок — useMyPaint(), чужой в комнате — useAvatarPaint(p)\n<Rumik colors="white" paint={paint ?? undefined} pose="cheer" />`}
            </pre>
            <p className="text-caption text-ink-3">
              Рисунок на этой странице — SVG той же рамки, чтобы витрина не тянула картинку. В продукте — PNG из{" "}
              <Link className="text-link underline-offset-2 hover:underline" href="/design/editor">
                рисовалки
              </Link>{" "}
              или с сервера (<Code>/api/avatar/&lt;id&gt;</Code>).
            </p>
          </Block>

          <Block
            id="heads"
            title="Головы: плитки и стопки"
            lead={
              <>
                Где места мало, Румик — головой. <Code>RumikAvatar</Code> заменяет кружок <Code>Avatar</Code> в строках
                списка, ленте под сценой, мини-комнате, шапке панели участника, в чате, тостах (32 px) и чипе показа на
                сцене (24 px); <Code>AvatarStack</Code> — в стопках «кто внутри». Цвет — тот же, что у кружка; с рисунком
                плитка белая под ним. В чате, тостах и чипе голова не показывает «говорит»: голос их не перерисовывает.
              </>
            }
          >
            <div className="flex flex-col gap-3">
              <p className="text-label text-ink-3">
                <Code>RumikAvatar</Code>: шкала размеров как у <Code>Avatar</Code> — xs 24 · sm 32 · md 44 · lg 72 · xl 96
                (или число px)
              </p>
              <div className="flex flex-wrap items-center gap-6">
                {HEAD_SIZES.map((s, i) => (
                  <RumikAvatar key={s} name={PEOPLE[i].name} colorIndex={PEOPLE[i].colorIndex} size={s} />
                ))}
                <RumikAvatar name="Саня" paint={SAMPLE_PAINT} size="xl" label="Саня, с рисунком" />
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <p className="text-label text-ink-3">
                Состояния. «Говорит» — лаймовое кольцо вокруг плитки, без волны (обводку по силуэту на 24–44 px срезал бы
                край). Мьют — значок в углу, как у <Code>Avatar</Code>; от 40 px глаза ещё и перечёркнуты.
              </p>
              <ul className="flex flex-wrap items-start gap-x-8 gap-y-5">
                {HEAD_STATES.map((st, i) => (
                  <li key={st.label} className="flex w-[84px] flex-col items-center gap-2 text-center">
                    <RumikAvatar
                      name={PEOPLE[i % PEOPLE.length].name}
                      colorIndex={PEOPLE[i % PEOPLE.length].colorIndex}
                      paint={st.paint ? SAMPLE_PAINT : null}
                      size="lg"
                      speaking={st.speaking}
                      status={st.status}
                    />
                    <span className="text-caption text-ink-3">{st.label}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-3">
                <p className="text-label text-ink-3">
                  <Code>frame=&quot;head&quot;</Code> у <Code>Rumik</Code> — квадратная рамка по голове с шапкой. Руки и ноги
                  из неё выходят (у SVG <Code>overflow: visible</Code>): в «Моих Румиках» это мини-фигурка, нужна только
                  голова — обрезка у обёртки
                </p>
                <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
                  <figure className="flex flex-col items-center gap-4">
                    <span className="block size-10 rounded-item border border-line bg-wash-1 p-1">
                      <Rumik colors="white" paint={SAMPLE_PAINT} frame="head" />
                    </span>
                    <figcaption className="font-code text-caption text-ink-3">«Мои Румики»</figcaption>
                  </figure>
                  {[64, 96].map((s) => (
                    <figure key={s} className="flex flex-col items-center gap-2">
                      <span className="block overflow-hidden rounded-item border border-line bg-wash-1">
                        <Rumik colors="white" paint={SAMPLE_PAINT} frame="head" size={s} />
                      </span>
                      <figcaption className="font-code text-caption text-ink-3">{s} overflow-hidden</figcaption>
                    </figure>
                  ))}
                  <figure className="flex flex-col items-center gap-2">
                    <span className="block overflow-hidden rounded-item border border-line bg-wash-1">
                      <Rumik colors={[6, 5, 4, 2]} hat="cap" frame="head" size={64} />
                    </span>
                    <figcaption className="font-code text-caption text-ink-3">64 cap</figcaption>
                  </figure>
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <p className="text-label text-ink-3">
                  <Code>AvatarStack</Code>: головы по умолчанию, <Code>variant=&quot;initials&quot;</Code> — кружки, если
                  Румиков выключили флагом <Code>rumik_table</Code>
                </p>
                <div className="flex flex-col items-start gap-4">
                  <AvatarStack people={PEOPLE} max={4} size="md" />
                  <AvatarStack people={PEOPLE} max={4} size="md" variant="initials" />
                  <AvatarStack people={[PEOPLE[0]]} total={5} max={1} size="sm" />
                </div>
              </div>
            </div>
          </Block>

          <Block
            id="reactions"
            title="Жесты реакций"
            lead={
              <>
                На реакцию в комнате (👍 🔥 😂 GG) Румик за столом отвечает жестом на 2 секунды, над головой всплывает
                пузырь. Поза меняется сразу, без анимации. Это единственное движение Румика в комнате, и только по
                событию. Мьют в глазах жест не перебивает: перечёркнутое кольцо — правда о микрофоне. При «меньше
                движения» жеста нет совсем — о реакции говорит только пузырь.
              </>
            }
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {REACTION_KINDS.map((kind, i) => {
                const g = REACTION_GESTURES[kind];
                const view = REACTION_VIEW[kind];
                return (
                  <Tile
                    key={kind}
                    code={`pose="${g.pose}"${g.eyes ? ` eyes="${g.eyes}"` : ""}`}
                    note={view.label}
                  >
                    {/* Как место за столом: пузырь — над головой (SEAT_HEAD_STYLE). */}
                    <div className="pt-6">
                      <div className={SEAT_FRAME_CLASS}>
                        <Rumik
                          colors={i === 0 ? "white" : PEOPLE[i].colorIndex}
                          paint={i === 0 ? SAMPLE_PAINT : undefined}
                          pose={g.pose}
                          eyes={g.eyes}
                        />
                        <span className="pointer-events-none absolute" style={SEAT_HEAD_STYLE}>
                          <ReactionBubbleSample glyph={view.glyph} className="bottom-full left-1/2 mb-1 -translate-x-1/2" />
                        </span>
                      </div>
                    </div>
                  </Tile>
                );
              })}
            </div>
          </Block>

          <Block id="playground" title="Песочница" lead="Соберите Румика и скопируйте строку кода.">
            <RumikPlayground options={PLAYGROUND} />
          </Block>

          <Block
            id="decor"
            title="Декор витрины"
            lead={
              <>
                Украшения по краям колонки 1200 живут в <Code>src/components/marketing/decor/</Code>. В рамку их не
                положить: они видны от 1400 px окна и встают от краёв секции. Ниже — настоящая секция витрины с ними.
              </>
            }
          >
            <ul className="grid gap-3 md:grid-cols-2">
              <DecorRule title="SideDecor">
                Румик в боковой полосе: <Code>side</Code>, <Code>top</Code> или <Code>sit</Code> (сидит на линии сверху
                секции). Ширина сама, 100–210 px. Внутри — <Code>{"<Rumik sticker … />"}</Code>, справа с <Code>flip</Code>,
                чтобы смотрел на страницу.
              </DecorRule>
              <DecorRule title="DecorSquare">
                Тихие скруглённые квадраты-«конфетти»: контурные полупрозрачные и залитые. <Code>inset</Code> — отступ от
                колонки наружу, <Code>color</Code> — индекс палитры.
              </DecorRule>
              <DecorRule title="DecorWall">
                «Стена» из трёх слоёв квадратов от 1700 px, прибита к окну, едет медленнее страницы при прокрутке. Одна на
                страницу витрины, не в общем layout.
              </DecorRule>
              <DecorRule title="Общее">
                Целиком, без обрезки; <Code>aria-hidden</Code>, <Code>pointer-events-none</Code>, absolute или fixed (ничего
                не сдвигает). Флаг <Code>rumik_decor</Code> в админке прячет всё, что с <Code>DECOR_OFF</Code>. Не больше
                одного-двух ярких Румиков на экран, фон тихий.
              </DecorRule>
            </ul>
            <p className="text-body text-ink-2">
              Живьём: <Link className="text-link underline-offset-2 hover:underline" href="/">главная</Link>,{" "}
              <Link className="text-link underline-offset-2 hover:underline" href="/pricing">/pricing</Link>,{" "}
              <Link className="text-link underline-offset-2 hover:underline" href="/clubs">/clubs</Link>,{" "}
              <Link className="text-link underline-offset-2 hover:underline" href="/rooms">/rooms</Link>. Смотрите на 1440 (края) и
              1920 (края и «стена»).
            </p>
          </Block>
        </div>

        <DecorDemo />

        <div className="mx-auto max-w-[1200px] px-5 pb-24">
          <Block id="rules" title="Где можно и где нельзя" lead="Витрина украшается, рабочие экраны нет.">
            <div className="rounded-card border border-line">
              <div
                aria-hidden="true"
                className="grid grid-cols-[200px_190px_1fr] gap-4 rounded-t-card bg-wash-1 px-4 py-2.5 text-label text-ink-3 max-md:hidden"
              >
                <span>Где</span>
                <span>Румик</span>
                <span>Как</span>
              </div>
              <ul className="divide-y divide-line">
                {RULES.map((r) => (
                  <li key={r.where} className="grid gap-1 px-4 py-3 text-body md:grid-cols-[200px_190px_1fr] md:gap-4">
                    <span className="font-medium text-ink">{r.where}</span>
                    <span className="flex items-start gap-1.5 text-ink-2">
                      <Icon
                        name={r.ok === "no" ? "x" : "check"}
                        size={16}
                        className={r.ok === "no" ? "mt-0.5 shrink-0 text-ink-3" : "mt-0.5 shrink-0 text-ink"}
                      />
                      {r.verdict}
                    </span>
                    <span className="text-ink-2">{r.how}</span>
                  </li>
                ))}
              </ul>
            </div>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-body text-ink-2 marker:text-ink-3">
              <li>
                В покое ничего не движется: Румик статичен, «стена» едет только пока крутят страницу, жест реакции в
                комнате — только по событию и на 2 секунды.
              </li>
              <li>
                Цвета только из токенов; исключение — краска рисунка (это данные человека, а не интерфейс). Никаких
                картинок нейросети — только этот SVG; без 3D.
              </li>
              <li>
                У каждой части Румика в комнате и лобби свой выключатель: <Code>rumik_editor</Code>,{" "}
                <Code>rumik_table</Code>, <Code>rumik_share</Code>, <Code>reactions</Code>.
              </li>
              <li>
                Без <Code>label</Code> Румик декоративный (<Code>aria-hidden</Code>). В пустом состоянии рядом всегда есть
                заголовок, поэтому подпись обычно не нужна.
              </li>
            </ul>
          </Block>
        </div>
      </main>
    </UiRoot>
  );
}

const RULES: { where: string; ok: "yes" | "part" | "no"; verdict: string; how: string }[] = [
  { where: "Главная /", ok: "yes", verdict: "да", how: "рисовалка в герое, края (SideDecor, DecorSquare), Румики в секциях, «стена» от 1700 px; в «Недавних» — головы" },
  { where: "/pricing, /clubs, /rooms", ok: "yes", verdict: "да", how: "края, «стена», Румики у карточек тарифов и в пустом списке, мини-стол на /clubs, голова хоста в строке комнаты" },
  { where: "404 и страницы ошибок", ok: "yes", verdict: "да", how: "Румик вместо значка в StateScreen (visual)" },
  { where: "Лобби", ok: "part", verdict: "свой Румик и состояния", how: "«Ваш Румик» с «Раскрасить» (свой аватар), стопка голов и мини-стол из Румиков с вашим местом «· вы»; «Комната заполнена», «Связь потеряна», «Вы вышли»" },
  { where: "Комната", ok: "part", verdict: "Румик — это человек", how: "места за столом и в ряду, головы в списке, ленте под сценой, мини-комнате и меню участника; жест реакции на 2 с. Украшений нет. Белый Румик в «Пока тут только вы» — только у круглого стола" },
  { where: "Настройки, диалоги, док, меню", ok: "no", verdict: "нет", how: "рабочие экраны: цвет только от людей и событий. Исключения — окно «Ваш Румик» с рисовалкой и открытка" },
  { where: "Юридические страницы, админка", ok: "no", verdict: "нет", how: "документы и инструменты: без краёв и «стены». В админке рисунок — только миниатюрой для модерации" },
];

function DecorRule({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="rounded-card border border-line p-4">
      <p className="font-code text-label text-ink">{title}</p>
      <p className="mt-1 text-pretty text-label text-ink-2">{children}</p>
    </li>
  );
}

const DECOR_FACTS = [
  { title: "От 1400 px", text: "Уже декор не рисуется: полос по бокам почти нет, а текст важнее." },
  { title: "Целиком", text: "Край окна ничего не режет. Румик — четверть свободной полосы, от 100 до 210 px." },
  { title: "Выключатель", text: "Флаг rumik_decor в админке прячет декор на всём сайте, пустые состояния остаются." },
];

/** Честный пример: настоящая секция витрины (marketing/Section) с декором по краям. */
function DecorDemo() {
  return (
    <SiteSection
      id="decor-demo"
      title="Секция витрины с декором"
      lead="Слева Румик сидит на линии секции, справа показывает на текст. Квадраты тихие, яркий только сам Румик."
      decor={
        <>
          <SideDecor side="left" sit>
            <Rumik pose="sit" colors={[8, 9, 0, 1]} sticker hat="beanie" eyes="wink" />
          </SideDecor>
          <SideDecor side="right" top={150}>
            <Rumik pose="point" colors={[1, 0, 9, 2]} sticker hat="cap" flip look={[-3, 2]} />
          </SideDecor>
          <DecorSquare side="left" top={200} inset={30} size={30} color={5} rotate={12} />
          <DecorSquare side="left" top={340} inset={70} size={18} color={0} rotate={-14} filled />
          <DecorSquare side="right" top={60} inset={60} size={22} color={8} rotate={18} />
          <DecorSquare side="right" top={330} inset={30} size={34} color={3} rotate={-10} filled />
        </>
      }
    >
      <ul className="grid gap-6 sm:grid-cols-3">
        {DECOR_FACTS.map((f) => (
          <li key={f.title}>
            <p className="text-title text-ink">{f.title}</p>
            <p className="mt-1 text-pretty text-body text-ink-2">{f.text}</p>
          </li>
        ))}
      </ul>
      <p className="mt-8 max-w-[60ch] text-label text-ink-3 min-[1400px]:hidden">
        Окно уже 1400 px: по краям пусто, так и задумано. Расширьте окно, и декор появится.
      </p>
      <p className="mt-8 max-w-[60ch] text-label text-ink-3 max-[1400px]:hidden">
        Секция — <Code>Section</Code> из <Code>components/marketing</Code>, украшения — в её пропе <Code>decor</Code>.
      </p>
    </SiteSection>
  );
}

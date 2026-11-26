"use client";

// Лендинг v2 — макет упрощённой главной (08.10.2026). Что изменилось против
// /design/landing:
//  • Румик стоит выше, рядом с формой, а не ниже всего; под ним — ряд готовых
//    раскрасок и «Случайный». Полная рисовалка спрятана за «Рисовать»;
//  • первый заход сразу даёт случайный скин — Румик не белый;
//  • никакой открытки и подписи на главной (она в меню рисовалки);
//  • карточка «Новая комната»: название и главная кнопка; пароль и «показать в
//    списке» — под «Ещё настройки»;
//  • «Есть код?» — строка-ссылка, а не вторая карточка; недавние — две строки.
// ?nick=1 — вариант с «карточкой игрока»: ник прямо под Румиком.

import { useState } from "react";
import {
  AvatarStack,
  Button,
  Card,
  Icon,
  Logo,
  Rumik,
  SettingRow,
  Switch,
  TextField,
  UiRoot,
  buttonClass,
  cn,
  type RumikColors,
} from "@/components/ui";
import { EditorGrid, FigureRug, VIEW_IN_STAGE } from "@/components/rumik/editorLayout";
import { LazyRumikEditor } from "@/components/rumik/LazyRumikEditor";
import { PEOPLE } from "./data";

type Preset = { colors: RumikColors };

/** Готовые раскраски — только то, что можно нарисовать самому: цвета по частям тела, без шапок и очков. */
const PRESETS: Preset[] = [
  { colors: 0 },
  { colors: 2 },
  { colors: 4 },
  { colors: 6 },
  { colors: 9 },
  { colors: [1, 0, 9, 2] },
  { colors: [6, 5, 4, 2] },
  { colors: [3, 4, 5, 6] },
  { colors: [8, 7, 6, 5] },
  { colors: [2, 3, 4, 0] },
];

const RECENT = [
  { title: "Вечерняя катка", code: "K7QMP4", when: "вчера", people: PEOPLE.slice(0, 3) },
  { title: "Rust с Даней", code: "P2WX9C", when: "3 дня назад", people: [PEOPLE[3], PEOPLE[4]] },
];

export function LandingMockV2({ theme, nick = false }: { theme?: "dark" | "light"; nick?: boolean }) {
  // Первый заход — случайный скин: Румик не белый.
  const [current, setCurrent] = useState(3);
  const [drawing, setDrawing] = useState(false);
  const [more, setMore] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [listed, setListed] = useState(false);
  const [code, setCode] = useState("");

  const random = () => {
    let next = current;
    while (next === current) next = Math.floor(Math.random() * PRESETS.length);
    setCurrent(next);
  };

  return (
    <UiRoot theme={theme} className="fixed inset-0 overflow-y-auto">
      <header className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between px-5">
        <Logo variant="lockup" height={28} className="text-ink" />
        <a href="/rooms" className={buttonClass({ variant: "ghost", size: "sm" })}>
          Открытые комнаты
        </a>
      </header>

      <main className="mx-auto grid w-full max-w-[1200px] items-start gap-10 px-5 pb-16 pt-4 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-x-16 lg:pt-10">
        {/* Слева: обещание и Румик. Румик — сразу под заголовком, на уровне формы. */}
        <section className="flex min-w-0 flex-col">
          <h1 className="text-balance font-brand text-hero text-ink">
            Заходи,
            <br />
            тут все свои
          </h1>
          <p className="mt-5 max-w-[40ch] text-pretty text-body-lg text-ink-2">
            Голосовая комната для своей компании. Одна ссылка, и вы слышите друг друга. Без регистрации.
          </p>

          <EditorSwitch
            drawing={drawing}
            current={current}
            onPick={setCurrent}
            onRandom={random}
            onDraw={() => setDrawing(true)}
            onDone={() => setDrawing(false)}
            nick={nick}
          />
        </section>

        {/* Справа: одно действие. */}
        <section className="flex min-w-0 flex-col gap-4">
          <Card padding="lg" className="flex flex-col gap-4">
            <h2 className="text-title text-ink">Новая комната</h2>
            <TextField
              label="Название"
              placeholder="Вечерняя катка"
              hint="Можно не заполнять: назовём по вашему нику"
              maxLength={40}
            />
            {more && (
              <>
                <TextField label="Пароль" type="password" placeholder="Без пароля" autoComplete="new-password" />
                <SettingRow
                  htmlFor="listed2"
                  title="Показать в списке комнат"
                  description="Зайти сможет любой со страницы «Открытые комнаты»"
                  control={<Switch id="listed2" checked={listed} onCheckedChange={setListed} />}
                  className="py-1"
                />
              </>
            )}
            <button
              type="button"
              aria-expanded={more}
              onClick={() => setMore((v) => !v)}
              className="flex items-center gap-1.5 self-start text-label text-ink-3 transition-colors duration-140 hover:text-ink"
            >
              <Icon name={more ? "chevron-up" : "chevron-down"} size={14} />
              {more ? "Скрыть настройки" : "Пароль и список комнат"}
            </button>
            <Button variant="primary" size="lg" icon="plus" block>
              Создать комнату
            </Button>
          </Card>

          <div className="px-1">
            {codeOpen ? (
              <form className="flex gap-2" onSubmit={(e) => e.preventDefault()}>
                <TextField
                  aria-label="Код комнаты или ссылка"
                  placeholder="K7QMP4 или ссылка"
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  wrapperClassName="flex-1"
                  className="font-brand tracking-[0.14em] placeholder:font-body placeholder:tracking-normal"
                />
                <Button variant="secondary" type="submit" disabled={code.trim().length < 6}>
                  Войти
                </Button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setCodeOpen(true)}
                className="text-label text-ink-2 underline decoration-line-strong underline-offset-4 transition-colors duration-140 hover:text-ink"
              >
                Есть код или ссылка?
              </button>
            )}
          </div>

          {/* Недавние: не больше двух строк и без заголовка-карточки; нет истории — блока нет. */}
          <ul className="flex flex-col" aria-label="Недавние комнаты">
            {RECENT.map((r) => (
              <li key={r.code}>
                <a
                  href={`/room/${r.code}`}
                  className="group flex items-center gap-3 rounded-card px-2 py-2 transition-colors duration-140 hover:bg-wash-1"
                >
                  <AvatarStack people={r.people} size="sm" max={3} />
                  <span className="min-w-0 flex-1 truncate text-label text-ink">
                    {r.title} <span className="text-ink-3">· {r.when}</span>
                  </span>
                  <Icon
                    name="chevron-right"
                    size={16}
                    className="text-ink-3 transition-transform duration-140 group-hover:translate-x-0.5"
                  />
                </a>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </UiRoot>
  );
}

type SwitchProps = {
  drawing: boolean;
  current: number;
  onPick: (i: number) => void;
  onRandom: () => void;
  onDraw: () => void;
  onDone: () => void;
  nick: boolean;
};

/** Кружок раскраски: голова Румика на круге; выбранный — с белым кольцом. */
function Skin({ i, current, onPick }: { i: number; current: number; onPick: (i: number) => void }) {
  return (
    <button
      type="button"
      aria-label={`Раскраска ${i + 1}`}
      aria-pressed={i === current}
      onClick={() => onPick(i)}
      className={cn(
        "grid size-11 shrink-0 place-items-center overflow-hidden rounded-full border bg-wash-2 transition-[border-color] duration-140",
        i === current ? "border-ink" : "border-line hover:border-line-strong",
      )}
    >
      <span className="w-9">
        <Rumik colors={PRESETS[i].colors} frame="head" />
      </span>
    </button>
  );
}

/**
 * Одно место, два состояния. Румик всегда в той же раскладке и того же размера, что
 * в рисовалке (EditorGrid hero). Просмотр: слева и справа от него поровну
 * раскраски, под ним «Случайный» и «Рисовать». Рисовать: на их месте инструменты и
 * цвет, Румик не двигается (колонки раскрасок той же высоты, что панель инструментов); выйти — «Готово» под палитрой.
 */
function EditorSwitch({ drawing, current, onPick, onRandom, onDraw, onDone, nick }: SwitchProps) {
  if (drawing) {
    return (
      <LazyRumikEditor
        variant="hero"
        className="mt-8"
        actions={
          <Button variant="secondary" size="sm" icon="check" onClick={onDone}>
            Готово
          </Button>
        }
      />
    );
  }
  const half = PRESETS.length / 2;
  const left = PRESETS.map((_, i) => i).slice(0, half);
  const right = PRESETS.map((_, i) => i).slice(half);
  return (
    <EditorGrid
      variant="hero"
      className="mt-8"
      tools={
        <ul aria-label="Раскраски" className="hidden h-[465px] flex-col items-center justify-between @min-[600px]:flex">
          {left.map((i) => (
            <li key={i}>
              <Skin i={i} current={current} onPick={onPick} />
            </li>
          ))}
        </ul>
      }
      figure={
        <>
          <FigureRug />
          <div className="pointer-events-none absolute" style={VIEW_IN_STAGE}>
            <Rumik colors={PRESETS[current].colors} label="Ваш Румик" />
          </div>
          {/* Широко: кнопки висят под ковриком, не занимая места в сетке, — Румик стоит там же, где в рисовалке. */}
          <div className="absolute inset-x-0 top-full hidden pt-3 @min-[600px]:block">
            <div className="flex flex-col items-center gap-4">
              {nick && (
                <TextField
                  aria-label="Ваш ник"
                  placeholder="Как вас зовут?"
                  defaultValue="Саня"
                  maxLength={20}
                  wrapperClassName="w-full max-w-[220px]"
                  className="text-center"
                />
              )}
              <div className="flex justify-center gap-3">
                <Button variant="secondary" icon="refresh" onClick={onRandom}>
                  Случайный
                </Button>
                <Button variant="secondary" icon="brush" onClick={onDraw}>
                  Рисовать
                </Button>
              </div>
            </div>
          </div>
        </>
      }
      below={null}
      panel={
        <>
          {/* Узко: кнопки обычной строкой под фигурой (в панели, чтобы место под фигурой в сетке не держалось). */}
          <div className="@min-[600px]:hidden">
            <div className="flex flex-col items-center gap-4">
              {nick && (
                <TextField
                  aria-label="Ваш ник"
                  placeholder="Как вас зовут?"
                  defaultValue="Саня"
                  maxLength={20}
                  wrapperClassName="w-full max-w-[220px]"
                  className="text-center"
                />
              )}
              <div className="flex justify-center gap-3">
                <Button variant="secondary" icon="refresh" onClick={onRandom}>
                  Случайный
                </Button>
                <Button variant="secondary" icon="brush" onClick={onDraw}>
                  Рисовать
                </Button>
              </div>
            </div>
          </div>
          <ul
            aria-label="Раскраски"
            className="hidden h-[465px] flex-col items-center justify-between self-start @min-[600px]:flex"
          >
            {right.map((i) => (
              <li key={i}>
                <Skin i={i} current={current} onPick={onPick} />
              </li>
            ))}
          </ul>
          {/* Узко: все раскраски одним рядом под фигурой. */}
          <ul aria-label="Раскраски" className="flex flex-wrap justify-center gap-2 @min-[600px]:hidden">
            {PRESETS.map((_, i) => (
              <li key={i}>
                <Skin i={i} current={current} onPick={onPick} />
              </li>
            ))}
          </ul>
        </>
      }
    />
  );
}

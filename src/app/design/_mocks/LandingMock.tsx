"use client";

// Лендинг — макет. Слева — обещание и рисовалка Румика (R2), справа — действия:
// создать комнату, войти по коду или ссылке, недавние. На узком — одна колонка,
// рисовалка после карточек: главное здесь — создать комнату.

import { useState } from "react";
import {
  AvatarStack,
  Button,
  Card,
  Icon,
  Logo,
  SettingRow,
  Switch,
  TextField,
  UiRoot,
  buttonClass,
} from "@/components/ui";
import { PostcardButton } from "@/components/rumik/PostcardButton";
import { LazyRumikEditor } from "@/components/rumik/LazyRumikEditor";
import { PEOPLE } from "./data";

const RECENT = [
  { title: "Вечерняя катка", code: "K7QMP4", when: "вчера", people: PEOPLE.slice(0, 3) },
  { title: "Rust с Даней", code: "P2WX9C", when: "3 дня назад", people: [PEOPLE[3], PEOPLE[4]] },
  { title: "Комната Сани", code: "H8ZT4M", when: "на прошлой неделе", people: [PEOPLE[4], PEOPLE[1], PEOPLE[2], PEOPLE[0]] },
];

export function LandingMock({ theme }: { theme?: "dark" | "light" }) {
  const [listed, setListed] = useState(false);
  const [code, setCode] = useState("");
  const ready = code.trim().length >= 6;

  return (
    <UiRoot theme={theme} className="fixed inset-0 overflow-y-auto">
      <header className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between px-5">
        <Logo variant="lockup" height={28} className="text-ink" />
        <a href="/rooms" className={buttonClass({ variant: "ghost", size: "sm" })}>
          <Icon name="globe" size={16} />
          Открытые комнаты
        </a>
      </header>

      <main className="mx-auto grid w-full max-w-[1200px] gap-10 px-5 pb-16 pt-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:grid-rows-[auto_1fr] lg:gap-x-16 lg:gap-y-0 lg:pt-14">
        <section className="flex min-w-0 flex-col lg:col-start-1 lg:row-start-1">
          <h1 className="text-balance font-brand text-hero text-ink">
            Заходи,
            <br />
            тут все свои
          </h1>
          <p className="mt-6 max-w-[44ch] text-pretty text-body-lg text-ink-2 sm:text-[17px] sm:leading-[1.55]">
            Голосовая комната для своей компании: чат и показ экрана. Без регистрации, прямо в браузере.
          </p>
        </section>

        <section className="flex min-w-0 flex-col gap-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <Card padding="lg" className="flex flex-col gap-4">
            <h2 className="text-title text-ink">Новая комната</h2>
            <TextField label="Название" placeholder="Вечерняя катка" hint="Можно не заполнять: назовём по вашему нику" maxLength={40} />
            <TextField label="Пароль" type="password" placeholder="Без пароля" autoComplete="new-password" />
            <SettingRow
              htmlFor="listed"
              title="Показать в списке комнат"
              description="Зайти сможет любой со страницы «Открытые комнаты»"
              control={<Switch id="listed" checked={listed} onCheckedChange={setListed} />}
              className="py-1"
            />
            <Button variant="primary" size="lg" icon="plus" block>
              Создать комнату
            </Button>
          </Card>

          <Card padding="lg" className="flex flex-col gap-3">
            <h2 className="text-title text-ink">Есть код или ссылка?</h2>
            <form className="flex gap-2" onSubmit={(e) => e.preventDefault()}>
              <TextField
                aria-label="Код комнаты или ссылка"
                placeholder="K7QMP4 или ссылка"
                size="lg"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                wrapperClassName="flex-1"
                className="font-brand tracking-[0.14em] placeholder:font-body placeholder:tracking-normal"
              />
              <Button variant="secondary" size="lg" type="submit" disabled={!ready}>
                Войти
              </Button>
            </form>
          </Card>

          <section aria-labelledby="recent" className="mt-2">
            <h2 id="recent" className="px-3 text-label font-medium text-ink-3">
              Недавние
            </h2>
            <ul className="mt-1 flex flex-col">
              {RECENT.map((r) => (
                <li key={r.code}>
                  <a
                    href={`/room/${r.code}`}
                    className="group flex items-center gap-3 rounded-card px-3 py-2.5 transition-colors duration-140 hover:bg-wash-1"
                  >
                    <AvatarStack people={r.people} size="sm" max={3} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium text-ink">{r.title}</span>
                      <span className="block text-caption text-ink-3">
                        {r.code} · {r.when}
                      </span>
                    </span>
                    <Icon name="chevron-right" size={18} className="text-ink-3 transition-transform duration-140 group-hover:translate-x-0.5" />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </section>

        <LazyRumikEditor
          variant="hero"
          className="min-w-0 lg:col-start-1 lg:row-start-2 lg:mt-8 lg:self-start"
          actions={<PostcardButton place="hero" />}
        />
      </main>
    </UiRoot>
  );
}

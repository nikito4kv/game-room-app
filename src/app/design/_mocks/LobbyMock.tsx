"use client";

// Лобби перед входом — макет. Слева: куда зовут и кто уже внутри (живой
// мини-стол: видно, кто говорит; внизу — ваше место «· вы» с вашим рисунком).
// Справа: ник, «Ваш Румик» с «Раскрасить» (рисовалка в окне, R2), устройства,
// проверка микрофона и «Войти». Клик по «Войти» — заодно жест, который
// разрешает браузеру звук (autoplay) и запуск обработки микрофона.

import { useEffect, useRef, useState } from "react";
import {
  AvatarStack,
  Button,
  Card,
  Dialog,
  LevelMeter,
  Logo,
  Rumik,
  Select,
  TextField,
  UiRoot,
} from "@/components/ui";
import { PostcardButton } from "@/components/rumik/PostcardButton";
import { LazyRumikEditor } from "@/components/rumik/LazyRumikEditor";
import { useMyPaint } from "@/lib/rumik/useMyRumik";
import { ME, PEOPLE, ROOM } from "./data";
import { RoundTable } from "./room-parts";

function useFakeVoice(): () => number {
  const t0 = useRef(0);
  useEffect(() => {
    t0.current = performance.now();
  }, []);
  return () => {
    const t = (performance.now() - t0.current) / 1000;
    const s = Math.max(0, Math.sin(t * 6.1) * 0.6 + Math.sin(t * 1.7) * 0.5);
    return Math.sin(t * 0.8) > -0.2 && s > 0.2 ? -34 + s * 20 : -56;
  };
}

export function LobbyMock({ password = false, theme }: { password?: boolean; theme?: "dark" | "light" }) {
  const inside = PEOPLE.filter((p) => !p.me).slice(0, 3).map((p) => ({ ...p, streaming: false }));
  const getLevel = useFakeVoice();
  const [nick, setNick] = useState("Саня");
  const [painting, setPainting] = useState(false);
  const paint = useMyPaint();
  return (
    <UiRoot theme={theme} className="fixed inset-0 overflow-y-auto">
      <header className="mx-auto flex h-16 w-full max-w-[1040px] items-center px-5">
        <Logo variant="lockup" height={26} className="text-ink" />
      </header>
      <main className="mx-auto grid w-full max-w-[1040px] items-center gap-8 px-5 pb-16 pt-4 lg:min-h-[calc(100dvh-64px-64px)] lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-14">
        <section className="flex min-w-0 flex-col">
          <p className="text-label text-ink-3">Вас зовут в комнату</p>
          <h1 className="mt-2 text-balance font-brand text-display text-ink">{ROOM.title}</h1>
          <div className="mt-4 flex items-center gap-3">
            <AvatarStack people={inside} size="sm" />
            <p className="text-body text-ink-2">Тёма, Ника и Лёха уже тут · говорит Тёма</p>
          </div>
          <div className="mt-4 h-[440px] w-full max-w-[520px] [container-type:size] max-lg:hidden">
            <div className="grid h-full place-items-center">
              {/* Ваше место — внизу, с вашим рисунком из этого браузера или вашим цветом. */}
              <RoundTable
                people={[...inside, { ...ME, name: nick.trim() || "Ваше место", streaming: false }]}
                center={<span className="font-brand text-[15px] font-semibold tracking-[0.16em] text-ink-3">{ROOM.code}</span>}
              />
            </div>
          </div>
        </section>

        <Card padding="lg" className="flex flex-col gap-5">
          <form className="flex flex-col gap-5" onSubmit={(e) => e.preventDefault()}>
            <TextField
              data-testid="join-nickname"
              label="Ваш ник"
              value={nick}
              onChange={(e) => setNick(e.target.value)}
              maxLength={24}
              autoComplete="nickname"
              hint="Так вас увидят друзья"
            />
            <div className="flex flex-col gap-1.5">
              <p className="text-label font-medium text-ink-2">Ваш Румик</p>
              <div className="flex items-center gap-3.5 rounded-card border border-line-strong bg-sunken p-3">
                <Rumik
                  colors={paint ? "white" : ME.colorIndex}
                  paint={paint ?? undefined}
                  size={84}
                  label={paint ? "Ваш Румик с рисунком" : "Ваш Румик без рисунка"}
                />
                <div className="flex min-w-0 flex-col items-start gap-2">
                  <Button size="sm" variant="secondary" icon="brush" onClick={() => setPainting(true)}>
                    Раскрасить
                  </Button>
                  <p className="text-caption text-ink-3">
                    {paint ? "Поменять можно в любой момент." : "Можно не рисовать: без рисунка ваш Румик будет одного цвета."}
                  </p>
                </div>
              </div>
            </div>
            {password && (
              <TextField
                data-testid="join-password"
                label="Пароль комнаты"
                type="password"
                autoComplete="current-password"
                error="Неверный пароль. Спросите у того, кто позвал."
              />
            )}
            <div className="flex flex-col gap-2">
              <Select
                label="Микрофон"
                icon="mic"
                defaultValue="hyperx"
                options={[
                  { value: "default", label: "Как в Windows" },
                  { value: "hyperx", label: "Микрофон (HyperX Cloud II)" },
                ]}
              />
              <LevelMeter getLevelDb={getLevel} mode="off" size="sm" label="Уровень вашего микрофона" />
              <p className="text-caption text-ink-3">Скажите что-нибудь: полоса должна двигаться.</p>
            </div>
            <div className="flex items-end gap-2">
              <Select
                label="Звук"
                icon="headphones"
                defaultValue="hyperx"
                wrapperClassName="flex-1"
                options={[
                  { value: "default", label: "Как в Windows" },
                  { value: "hyperx", label: "Наушники (HyperX Cloud II)" },
                ]}
              />
              <Button variant="secondary" icon="volume">
                Проверить
              </Button>
            </div>
            <Button data-testid="join-submit" variant="primary" size="lg" icon="log-in" block type="submit">
              Войти в комнату
            </Button>
            <p className="-mt-2 text-center text-caption text-ink-3">Микрофон включится сразу. Выключить можно клавишей M.</p>
          </form>
          {/* Окно — вне <form>: Enter в поле рисовалки не должен отправлять вход.
              Рисунок сохраняется сам, поэтому вместо крестика — маленькая «Готово» в шапке. */}
          <Dialog
            open={painting}
            onOpenChange={setPainting}
            title="Ваш Румик"
            size="lg"
            headerAction={
              <Button size="sm" variant="secondary" onClick={() => setPainting(false)}>
                Готово
              </Button>
            }
          >
            {painting && <LazyRumikEditor variant="dialog" actions={<PostcardButton place="lobby" />} />}
          </Dialog>
        </Card>
      </main>
    </UiRoot>
  );
}

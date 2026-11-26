"use client";

// Ошибки и «нештатные» экраны — макет. Правило: у каждого тупика есть
// главное действие, которое чинит ситуацию («Переподключиться», «Попробовать
// снова»), и запасное («На главную»). Технические тексты LiveKit на экран не
// выводим — только понятная причина и что делать. Там, где поза объясняет,
// что случилось, вместо значка Румик (как в join/SessionScreen.tsx); строгие
// тупики (выгнали, комнаты нет, голос) — со значками.

import type { ReactNode } from "react";
import { Button, InlineAlert, Logo, Rumik, StateScreen, UiRoot } from "@/components/ui";
import { ROOM } from "./data";

const LOST = <Rumik colors={[1, 0, 9, 2]} sticker extra="bang" eyes="lost" tilt={5} />;

/** «Комната заполнена»: трое внахлёст, место под картинку шире на 44%. */
const CROWD = (
  <div className="-mx-[22%] flex">
    <div className="w-[38%] shrink-0">
      <Rumik colors={[0, 1, 2, 9]} sticker eyes="wide" />
    </div>
    <div className="-ml-[7%] w-[38%] shrink-0">
      <Rumik colors={[8, 7, 6, 5]} sticker eyes="wide" flip />
    </div>
    <div className="-ml-[7%] w-[38%] shrink-0">
      <Rumik colors={[3, 4, 5, 6]} sticker eyes="wide" />
    </div>
  </div>
);

export function LostScreen() {
  return (
    <UiRoot className="fixed inset-0 grid place-items-center overflow-y-auto p-6">
      <div className="absolute left-5 top-4">
        <Logo variant="lockup" height={24} className="text-ink" />
      </div>
      <StateScreen
        visual={LOST}
        title="Связь потеряна"
        actions={
          <>
            <Button variant="primary" size="lg" icon="reconnect" block>
              Переподключиться
            </Button>
            <Button variant="ghost" block>
              На главную
            </Button>
          </>
        }
      >
        Не получилось вернуть вас в комнату «{ROOM.title}» автоматически. Проверьте интернет: комната вас ждёт.
      </StateScreen>
    </UiRoot>
  );
}

function Frame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-label text-ink-3">{label}</figcaption>
      <div className="grid min-h-[360px] place-items-center rounded-panel border border-line bg-canvas p-8">{children}</div>
    </figure>
  );
}

export function StatesMock() {
  return (
    <UiRoot className="fixed inset-0 overflow-y-auto">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-8 px-5 py-10">
        <header>
          <h1 className="font-brand text-heading text-ink">Ошибки и переподключение</h1>
          <p className="mt-1 text-body text-ink-2">У каждого тупика есть действие, которое чинит ситуацию.</p>
        </header>
        <div className="grid gap-6 md:grid-cols-2">
          <Frame label="Обрыв: финальный экран">
            <StateScreen titleAs="h2"
              visual={LOST}
              title="Связь потеряна"
              actions={
                <>
                  <Button variant="primary" icon="reconnect" block>
                    Переподключиться
                  </Button>
                  <Button variant="ghost" block>
                    На главную
                  </Button>
                </>
              }
            >
              Не получилось вернуть вас в комнату автоматически. Проверьте интернет: комната вас ждёт.
            </StateScreen>
          </Frame>
          {/* Ник занят — не экран, а подсказка у поля ника в лобби («Взять «Тёма 2»»):
              свой второй вход с того же устройства заменяет старый, «призраков» нет. */}
          <Frame label="Вы вышли (после «Выйти», без подтверждения)">
            <StateScreen titleAs="h2"
              visual={<Rumik colors={[2, 3, 4, 0]} sticker pose="wave" eyes="wink" hat="beanie" />}
              title={`Вы вышли из комнаты «${ROOM.title}»`}
              actions={
                <>
                  <Button variant="primary" size="lg" icon="log-in" block>
                    Вернуться
                  </Button>
                  <Button variant="ghost" block>
                    На главную
                  </Button>
                </>
              }
            >
              Друзья остались в комнате. Вернуться можно сразу.
            </StateScreen>
          </Frame>
          <Frame label="Комната заполнена">
            <StateScreen titleAs="h2"
              visual={CROWD}
              title="Комната заполнена"
              actions={
                <>
                  <Button variant="primary" icon="reconnect" block>
                    Попробовать снова
                  </Button>
                  <Button variant="ghost" icon="plus" block>
                    Создать свою комнату
                  </Button>
                </>
              }
            >
              Сейчас внутри 6 из 6. Попросите кого-нибудь выйти и заходите.
            </StateScreen>
          </Frame>
          <Frame label="Выгнали (кик)">
            <StateScreen titleAs="h2"
              icon="user-x"
              tone="alert"
              title="Вас выгнали из комнаты"
              actions={
                <>
                  <Button variant="primary" size="lg" icon="log-in" block disabled>
                    Вернуться в комнату
                  </Button>
                  <Button variant="ghost" block>
                    На главную
                  </Button>
                </>
              }
            >
              Хост выгнал вас из комнаты «{ROOM.title}». Вернуться можно через 4:59.
            </StateScreen>
          </Frame>
          <Frame label="Комнаты нет">
            <StateScreen titleAs="h2"
              icon="search"
              title={`Комнаты ${ROOM.code} нет`}
              actions={
                <>
                  <Button variant="primary" icon="plus" block>
                    Создать комнату
                  </Button>
                  <Button variant="ghost" block>
                    Ввести другой код
                  </Button>
                </>
              }
            >
              Возможно, все вышли и она закрылась, или в коде опечатка.
            </StateScreen>
          </Frame>
          <Frame label="Не удалось подключиться к голосу (UDP закрыт, VPN)">
            <StateScreen titleAs="h2"
              icon="alert-triangle"
              tone="caution"
              title="Не получилось подключиться к голосу"
              actions={
                <>
                  <Button variant="primary" icon="reconnect" block>
                    Попробовать снова
                  </Button>
                  <Button variant="ghost" block>
                    На главную
                  </Button>
                </>
              }
            >
              Проверьте интернет или выключите VPN. В клубе иногда закрыты нужные порты: попробуйте раздать интернет с телефона.
            </StateScreen>
          </Frame>
        </div>

        <section className="flex flex-col gap-3">
          <h2 className="text-title text-ink">Внутри комнаты: плашки над столом</h2>
          <p className="text-body text-ink-2">Всё, что значит «вас не слышно», — красное, как кнопка микрофона.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <InlineAlert
              tone="alert"
              title="Нет доступа к микрофону"
              action={
                <Button size="sm" variant="secondary">
                  Повторить
                </Button>
              }
            >
              Вас не слышно. Разрешите микрофон: значок слева от адреса сайта → «Микрофон» → «Разрешить», потом нажмите «Повторить».
            </InlineAlert>
            <InlineAlert
              tone="alert"
              title="Микрофон занят"
              action={
                <Button size="sm" variant="secondary">
                  Повторить
                </Button>
              }
            >
              Вас не слышно: микрофон держит другая программа или вкладка. Закройте её и нажмите «Повторить».
            </InlineAlert>
            <InlineAlert tone="alert" title="Хост выключил ваш микрофон">
              Включить его снова может только хост.
            </InlineAlert>
            <InlineAlert tone="info" title="Хост выключил чат">
              Сообщения пока не отправляются. Голос и экран работают как обычно.
            </InlineAlert>
          </div>
        </section>
      </div>
    </UiRoot>
  );
}

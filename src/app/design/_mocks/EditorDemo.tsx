"use client";

// Витрина рисовалки Румика (R2): /design/editor, ?theme=light. Те же
// LazyRumikEditor и «Открытка», что на главной (hero) и в окне лобби (dialog):
// раскладка по ширине контейнера, «Мои Румики», клавиши. Рисунок общий — он в
// хранилище этого браузера. Правила — DESIGN_SYSTEM.md §8 «Рисовалка».

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Button, buttonClass } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/Kbd";
import { Logo } from "@/components/ui/Logo";
import { UiRoot } from "@/components/ui/UiRoot";
import { LazyRumikEditor, type RumikEditorEvent } from "@/components/rumik/LazyRumikEditor";
import { PostcardButton } from "@/components/rumik/PostcardButton";
import { formatKeyCode } from "@/lib/keys";

/** Раскладки hero по ширине контейнера — те же пороги, что в editorLayout.tsx. */
const WIDTHS: { width: number; title: string; text: string }[] = [
  { width: 540, title: "Средне: 480–599 px", text: "Панель инструментов строкой сверху, под ней фигура и «Цвет» рядом; место под два ряда «Моих Румиков». Колонка героя на окне 1024." },
  { width: 380, title: "Узко: меньше 480 px", text: "Всё столбиком. Уже 448 px панель — в два ряда: рисование и история с файлом. Место под «Мои Румики» не держится." },
];

const KEYS: { keys: string[]; text: string }[] = [
  { keys: [formatKeyCode("KeyB")], text: "кисть" },
  { keys: [formatKeyCode("KeyE")], text: "ластик" },
  { keys: [formatKeyCode("KeyG")], text: "заливка части" },
  { keys: [formatKeyCode("KeyI")], text: "пипетка" },
  { keys: [formatKeyCode("KeyM")], text: "зеркало" },
  { keys: ["Ctrl+Z"], text: "назад (⌘Z на Mac)" },
  { keys: ["Ctrl+Shift+Z", "Ctrl+Y"], text: "вперёд" },
];

function Section({ id, title, lead, children }: { id: string; title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4 border-t border-line pt-10">
      <h2 id={`${id}-title`} className="font-brand text-heading text-ink">
        {title}
      </h2>
      {lead && <p className="max-w-[70ch] text-pretty text-body text-ink-2">{lead}</p>}
      {children}
    </section>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <code className="font-code text-[0.92em] text-ink">{children}</code>;
}

export function EditorDemo({ theme }: { theme?: "light" }) {
  const [events, setEvents] = useState<RumikEditorEvent[]>([]);
  const [open, setOpen] = useState(false);
  const onEvent = (e: RumikEditorEvent) => setEvents((list) => [...list, e]);
  const otherTheme = theme === "light" ? "/design/editor" : "/design/editor?theme=light";

  return (
    <UiRoot theme={theme} className="fixed inset-0 overflow-y-auto">
      <header className="sticky top-0 z-[var(--gr-z-sticky)] border-b border-line bg-canvas">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-3 px-5">
          <Link href="/design" className="shrink-0" aria-label="Витрина дизайн-системы">
            <Logo variant="lockup" height={24} className="text-ink" />
          </Link>
          <span className="text-label text-ink-3 max-sm:hidden">Рисовалка Румика · бренд-слой</span>
          <div className="ml-auto flex items-center gap-1">
            <Link href="/design/rumik" className={buttonClass({ variant: "ghost", size: "sm", className: "max-sm:hidden" })}>
              Румик
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

      <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-10 px-5 pb-24 pt-10">
        <div className="flex flex-col gap-3">
          <h1 className="font-brand text-display text-ink">Рисовалка Румика</h1>
          <p className="max-w-[64ch] text-pretty text-body-lg text-ink-2">
            Человек раскрашивает своего Румика, и таким его видят в комнате. На главной рисовалка стоит в герое, в лобби
            — в окне «Ваш Румик». На страницу ставится только <Code>LazyRumikEditor</Code>: код рисовалки приезжает
            лениво, до него стоит заглушка той же раскладки. Рисунок общий для всех рисовалок на этой странице: он лежит в
            хранилище браузера.
          </p>
          <pre className="max-w-full overflow-x-auto rounded-card border border-line bg-sunken px-4 py-3 font-code text-label text-ink-2">
            {`import { LazyRumikEditor } from "@/components/rumik/LazyRumikEditor";\n\n<LazyRumikEditor variant="hero" actions={<PostcardButton place="hero" />} onEvent={…} />`}
          </pre>
        </div>

        <Section
          id="hero"
          title="hero — герой главной"
          lead="Широко (от 600 px контейнера): панель инструментов столбиком слева, фигура, справа «Цвет». Под фигурой — «Мои Румики»: место под ряд миниатюр держится заранее. Кнопки панели 40 px. На главной рисовалка — область <section> со скрытым заголовком «Ваш Румик»."
        >
          <div data-testid="editor-hero" className="w-full max-w-[676px]">
            <LazyRumikEditor variant="hero" actions={<PostcardButton place="hero" />} onEvent={onEvent} />
          </div>
        </Section>

        <Section
          id="widths"
          title="Раскладка по ширине контейнера"
          lead="Раскладку выбирает ширина контейнера (container queries), а не окна: рисовалка живёт и в колонке героя, и в окне."
        >
          <div className="flex flex-wrap items-start gap-8">
            {WIDTHS.map((w) => (
              <figure key={w.width} className="flex w-full flex-col gap-3" style={{ maxWidth: w.width }}>
                <figcaption>
                  <span className="block text-title text-ink">{w.title}</span>
                  <span className="mt-0.5 block text-label text-ink-3">{w.text}</span>
                </figcaption>
                <div className="rounded-card border border-dashed border-line-strong p-3">
                  <LazyRumikEditor variant="hero" />
                </div>
              </figure>
            ))}
          </div>
        </Section>

        <Section
          id="dialog"
          title="dialog — окно «Ваш Румик» в лобби"
          lead="Dialog lg, в шапке вместо крестика — маленькая «Готово» (headerAction): рисунок сохраняется сам. Esc и подложка закрывают как обычно. Компактнее: пороги 460 и 560 px, кнопки панели 32 px. В лобби окно стоит вне <form>: Enter в поле цвета не отправляет вход."
        >
          <Button variant="secondary" icon="brush" className="self-start" onClick={() => setOpen(true)} data-testid="open-editor-dialog">
            Раскрасить
          </Button>
          <Dialog
            open={open}
            onOpenChange={setOpen}
            title="Ваш Румик"
            size="lg"
            headerAction={
              <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
                Готово
              </Button>
            }
          >
            {open && <LazyRumikEditor variant="dialog" actions={<PostcardButton place="lobby" />} onEvent={onEvent} />}
          </Dialog>
        </Section>

        <Section id="rules" title="Как устроено">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <p className="text-title text-ink">Клавиши</p>
              <ul className="flex flex-col gap-1.5">
                {KEYS.map((k) => (
                  <li key={k.text} className="flex items-center gap-2 text-body text-ink-2">
                    <span className="flex w-36 shrink-0 flex-wrap gap-1">
                      {k.keys.map((key) => (
                        <Kbd key={key}>{key}</Kbd>
                      ))}
                    </span>
                    {k.text}
                  </li>
                ))}
              </ul>
              <p className="text-caption text-ink-3">
                По физической клавише (<Code>e.code</Code>), в любой раскладке. Не работают в полях ввода, когда рисовалка
                вне экрана и когда поверх неё чужое окно (<Code>editorOwnsKey</Code>). Неактивные кнопки панели остаются в
                фокусе (<Code>aria-disabled</Code>), причина — в подсказке.
              </p>
            </div>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-body text-ink-2 marker:text-ink-3">
              <li>
                Рисунок — PNG слоя краски 572×480, прозрачный вне фигуры. Лежит в браузере: текущий — в{" "}
                <Code>gr.rumik.v1</Code>, «Мои Румики» (до 8) — в <Code>gr.rumik.v1.gallery</Code>; на все рисунки —
                1,5 млн символов, лишние уходят из галереи, старые первыми.
              </li>
              <li>
                «Мои Румики»: миниатюры 36 px с переносом строки, крестик 24 px; убранный можно вернуть 6 с («Удалено ·
                Вернуть»). Тот же рисунок второй раз не ложится.
              </li>
              <li>
                «Сохранить файл» — всегда rumik.png 572×480; «Загрузить свой» принимает и 286×240. Не тот файл — одна
                фраза: «Это не рисунок Румика».
              </li>
              <li>Палитра — краска рисунка (hex, данные); пипетка прилипает к ней на ±2; фигура на холсте — в цветах токенов.</li>
              <li>Глаза следят за курсором, только пока он двигается; при «меньше движения» стоят.</li>
              <li>
                «Открытка» — лёгкая кнопка в <Code>actions</Code>; окно (<Code>PostcardDialog</Code>) грузится по наведению
                или нажатию, PNG 1200×630 собирается в браузере.
              </li>
              <li>
                Флаг <Code>rumik_editor</Code> выключен — на главной круглый мини-стол с кружками, в лобби блока «Ваш
                Румик» нет (его нет и без <Code>rumik_table</Code>).
              </li>
            </ul>
          </div>
        </Section>

        <p data-testid="editor-events" className="text-caption text-ink-3">
          События <Code>onEvent</Code> (для аналитики): {events.length > 0 ? events.join(", ") : "пока нет"}
        </p>
      </main>
    </UiRoot>
  );
}

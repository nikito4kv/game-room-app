"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AVATAR_COLORS,
  Avatar,
  AvatarStack,
  Badge,
  Button,
  Card,
  ChoiceGroup,
  CountBadge,
  Dialog,
  EmptyState,
  ICON_NAMES,
  Icon,
  IconButton,
  InlineAlert,
  Kbd,
  LevelMeter,
  Logo,
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Popover,
  PopoverItem,
  Rumik,
  SegmentedControl,
  Select,
  SettingRow,
  QrCode,
  SignalBars,
  Skeleton,
  Slider,
  Spinner,
  StateScreen,
  Switch,
  Tab,
  TabList,
  TabPanel,
  TablePreview,
  Tabs,
  TextField,
  Toaster,
  Tooltip,
  UiRoot,
  buttonClass,
  toast,
  type GateMode,
} from "@/components/ui";
import { RumikAvatar } from "@/components/ui/Avatar";
import { PEOPLE } from "../_mocks/data";
import { Dock, FakeScreen, InvitePanel } from "../_mocks/room-parts";
import { SAMPLE_PAINT } from "../_mocks/rumikSamples";

/* ------------------------------------------------------------- Каркас */

function Section({ id, title, lead, children }: { id: string; title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-line py-12 first:border-t-0">
      <h2 className="font-brand text-heading text-ink">{title}</h2>
      {lead && <p className="mt-2 max-w-[70ch] text-body text-ink-2">{lead}</p>}
      <div className="mt-6 flex flex-col gap-8">{children}</div>
    </section>
  );
}

function Row({ label, children, className }: { label?: string; children: ReactNode; className?: string }) {
  return (
    <div className="flex flex-col gap-3">
      {label && <p className="text-label text-ink-3">{label}</p>}
      <div className={className ?? "flex flex-wrap items-center gap-3"}>{children}</div>
    </div>
  );
}

const MOCKS: { href: string; title: string; text: string }[] = [
  { href: "/design/landing", title: "Лендинг", text: "Рисовалка в герое, создать, войти по коду или ссылке, недавние" },
  { href: "/design/landing-2", title: "Лендинг v2 (макет)", text: "Румик выше, готовые раскраски и «Случайный», одна форма, недавние в две строки" },
  { href: "/design/lobby", title: "Лобби", text: "Ник, «Ваш Румик», устройства, кто уже внутри" },
  { href: "/design/lobby?password=1", title: "Лобби с паролем", text: "Поле пароля и ошибка" },
  { href: "/design/room", title: "Комната", text: "Стол из Румиков, док, шапка с «Пригласить»" },
  { href: "/design/room?v=alone", title: "Вы один", text: "Пустое состояние в центре стола" },
  { href: "/design/room?chat=1&toasts=1", title: "Чат и тосты", text: "Панель чата, непрочитанные, ссылки, ошибка" },
  { href: "/design/room?v=stage", title: "Сцена", text: "Чужой экран: управление поверх видео" },
  { href: "/design/room?v=stage-two&zoom=1&stats=1", title: "Два показа, зум, «i»", text: "Выбор показа и статистика" },
  { href: "/design/room?v=stage-self", title: "Вы показываете экран", text: "Плашка вместо своего превью" },
  { href: "/design/room?invite=1", title: "Пригласить", text: "Ссылка скопирована + код" },
  { href: "/design/room?reconnecting=1&mic=off", title: "Переподключение", text: "Баннер, микрофон выключен" },
  { href: "/design/room?mic=ptt-talk&keys=1", title: "Рация", text: "В эфире по клавише, буквы на кнопках" },
  { href: "/design/settings", title: "Настройки", text: "Голос: порог по полосе, Авто/Вручную/Выкл" },
  { href: "/design/host", title: "Меню участника", text: "Громкость для себя и действия хоста" },
  { href: "/design/host?view=kick", title: "Подтверждение кика", text: "Прямо в меню, без второго окна" },
  { href: "/design/host?view=room", title: "Настройки комнаты", text: "Вход, права, баны" },
  { href: "/design/pip", title: "Мини-комната (PiP)", text: "Поверх игры: головы, кто говорит + 2 кнопки" },
  { href: "/design/states", title: "Ошибки", text: "Обрыв, ник занят, комната полна, кик" },
  { href: "/design/lost", title: "Связь потеряна", text: "Финальный экран с «Переподключиться»" },
  { href: "/design/rumik", title: "Румик", text: "Позы, глаза, рисунок, головы, жесты, песочница" },
  { href: "/design/editor", title: "Рисовалка Румика", text: "Герой главной и окно лобби: раскладки, клавиши, открытка" },
];

const SWATCHES: { group: string; items: { name: string; v: string; note: string; text?: boolean }[] }[] = [
  {
    group: "Поверхности",
    items: [
      { name: "video", v: "--gr-video", note: "поля у видео" },
      { name: "sunken", v: "--gr-sunken", note: "поля ввода, дорожки" },
      { name: "canvas", v: "--gr-canvas", note: "фон приложения" },
      { name: "raised", v: "--gr-raised", note: "карточки, док, чат" },
      { name: "overlay", v: "--gr-overlay", note: "меню, диалоги, тосты" },
    ],
  },
  {
    group: "Текст",
    items: [
      { name: "ink", v: "--gr-ink", note: "основной", text: true },
      { name: "ink-2", v: "--gr-ink-2", note: "вторичный", text: true },
      { name: "ink-3", v: "--gr-ink-3", note: "подсказки, AA", text: true },
      { name: "ink-faint", v: "--gr-ink-faint", note: "выключенное", text: true },
    ],
  },
  {
    group: "Смысл",
    items: [
      { name: "signal", v: "--gr-signal", note: "передаёт: говорит, эфир" },
      { name: "alert", v: "--gr-alert", note: "не слышно, опасно" },
      { name: "caution", v: "--gr-caution", note: "внимание" },
      { name: "crown", v: "--gr-crown", note: "хост" },
      { name: "link", v: "--gr-link", note: "ссылки" },
      { name: "focus", v: "--gr-focus", note: "фокус клавиатуры" },
    ],
  },
];

/* ------------------------------------------------------------ Витрина */

export function Showcase() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  return (
    <UiRoot theme={theme} className="fixed inset-0 overflow-y-auto">
      <header className="sticky top-0 z-[var(--gr-z-sticky)] border-b border-line bg-canvas">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-4 px-5">
          <Logo variant="lockup" height={24} className="text-ink" />
          <span className="text-label text-ink-3 max-sm:hidden">дизайн-система «Эфир»</span>
          <div className="ml-auto">
            <SegmentedControl
              label="Тема"
              size="sm"
              value={theme}
              onValueChange={setTheme}
              options={[
                { value: "dark", label: "Тёмная", icon: "moon" },
                { value: "light", label: "Светлая", icon: "sun" },
              ]}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] px-5 pb-24">
        <Section
          id="mocks"
          title="Макеты экранов"
          lead="Полноэкранные макеты на моковых данных. Открывайте на 1440, 1024 и 390 px: узкое окно сбоку от игры — главный сценарий."
        >
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {MOCKS.map((m) => (
              <li key={m.href}>
                <a
                  href={m.href}
                  className="group flex h-full items-start gap-3 rounded-card border border-line p-4 transition-colors duration-140 hover:border-line-strong hover:bg-wash-1"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-semibold text-ink">{m.title}</span>
                    <span className="mt-0.5 block text-label text-ink-3">{m.text}</span>
                  </span>
                  <Icon name="arrow-right" size={18} className="mt-0.5 text-ink-3 transition-transform duration-140 group-hover:translate-x-0.5" />
                </a>
              </li>
            ))}
          </ul>
        </Section>

        <ColorSection />
        <TypeSection />
        <ButtonsSection />
        <FieldsSection />
        <ChoiceSection />
        <LevelSection />
        <AvatarSection />
        <MarksSection />
        <MessagesSection />
        <FloatingSection />
        <IconsSection />
        <LogoSection />
        <RumikSection />
      </main>
      <Toaster />
    </UiRoot>
  );
}

function ColorSection() {
  return (
    <Section
      id="color"
      title="Цвет"
      lead="Интерфейс графитовый и тихий. Цвет приносят люди (палитра аватаров) и события. Один цвет — один смысл, декоративного цвета нет."
    >
      {SWATCHES.map((g) => (
        <Row key={g.group} label={g.group} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {g.items.map((s) => (
            <div key={s.name} className="overflow-hidden rounded-card border border-line">
              {s.text ? (
                <div className="grid h-16 place-items-center bg-canvas font-brand text-heading" style={{ color: `var(${s.v})` }}>
                  Аа
                </div>
              ) : (
                <div className="h-16" style={{ background: `var(${s.v})` }} />
              )}
              <div className="px-3 py-2">
                <p className="font-code text-label text-ink">{s.name}</p>
                <p className="text-caption text-ink-3">{s.note}</p>
              </div>
            </div>
          ))}
        </Row>
      ))}
      <Row label="Палитра аватаров: 10 оттенков одной светлоты, без жёлто-зелёного (он у signal)" className="flex flex-wrap gap-3">
        {Array.from({ length: AVATAR_COLORS }, (_, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <span className="size-12 rounded-full" style={{ background: `var(--gr-avatar-${i})` }} />
            <span className="font-code text-caption text-ink-3">{i}</span>
          </div>
        ))}
      </Row>
    </Section>
  );
}

function TypeSection() {
  const rows: { cls: string; name: string; sample: string }[] = [
    { cls: "font-brand text-hero", name: "hero · Unbounded 700", sample: "Заходи, тут все свои" },
    { cls: "font-brand text-display", name: "display · Unbounded 600", sample: "Вечерняя катка" },
    { cls: "font-brand text-heading", name: "heading · Unbounded 600", sample: "Пока тут только вы" },
    { cls: "text-title", name: "title · Onest 600", sample: "Чувствительность микрофона" },
    { cls: "text-body-lg", name: "body-lg · Onest 400", sample: "го ещё одну, пока Лёха не ушёл" },
    { cls: "text-body", name: "body · Onest 400", sample: "Убирает гул кулеров, клавиатуру и фон" },
    { cls: "text-label", name: "label · Onest 400", sample: "Вас слышно, когда полоса заходит за отметку" },
    { cls: "text-caption", name: "caption · Onest 400", sample: "21:06 · Видно сообщения с момента, как вы зашли" },
    { cls: "text-micro font-semibold", name: "micro · Onest 600", sample: "9+ · ЭФИР · M" },
  ];
  return (
    <Section
      id="type"
      title="Типографика"
      lead="Unbounded — широкий гротеск с характером: названия комнат, крупные заголовки, код комнаты. Onest — всё остальное, рисовался под кириллицу. Цифры — tabular-nums."
    >
      <div className="flex flex-col divide-y divide-line">
        {rows.map((r) => (
          <div key={r.name} className="grid gap-2 py-4 sm:grid-cols-[220px_1fr] sm:items-baseline">
            <span className="font-code text-caption text-ink-3">{r.name}</span>
            <span className={`${r.cls} min-w-0 text-ink`}>{r.sample}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

function ButtonsSection() {
  const [volume, setVolume] = useState(100);
  return (
    <Section
      id="buttons"
      title="Кнопки"
      lead="primary — одно главное действие на экране, «чернильное». Красная заливка — только «вас не слышно» и необратимое. Нажатие — scale 0.97, 100 мс."
    >
      <Row label="Варианты">
        <Button variant="primary" icon="user-plus">
          Пригласить
        </Button>
        <Button variant="secondary" icon="copy">
          Скопировать ссылку
        </Button>
        <Button variant="ghost">Отмена</Button>
        <Button variant="danger" icon="user-x">
          Выгнать
        </Button>
      </Row>
      <Row label="Размеры sm · md · lg, загрузка, выключена">
        <Button size="sm">Маленькая</Button>
        <Button size="md">Обычная</Button>
        <Button size="lg" variant="primary" icon="log-in">
          Войти в комнату
        </Button>
        <Button variant="primary" loading>
          Создаём
        </Button>
        <Button disabled>Недоступна</Button>
        <a href="#buttons" className={buttonClass({ variant: "secondary", size: "sm" })}>
          Ссылка как кнопка
        </a>
      </Row>
      <Row label="IconButton: ghost · quiet · soft · inverse · danger · signal · danger-ghost (наведите: подсказка с клавишей)">
        <IconButton icon="settings" label="Настройки" variant="ghost" />
        <IconButton icon="chevron-down" label="Ещё" variant="quiet" />
        <IconButton icon="mic" label="Выключить микрофон" shortcut="M" variant="soft" />
        <IconButton icon="screen-stop" label="Остановить показ" shortcut="S" variant="inverse" />
        <IconButton icon="mic-off" label="Включить микрофон" shortcut="M" variant="danger" />
        <IconButton icon="radio" label="Рация: вы в эфире" shortcut="V" variant="signal" showShortcut />
        <IconButton icon="leave" label="Выйти из комнаты" variant="danger-ghost" />
        <IconButton icon="chat" label="Открыть чат" shortcut="Enter" variant="soft" shape="round" size="lg" badge={<CountBadge count={3} />} />
        <IconButton icon="settings" label="Загрузка" variant="soft" loading />
      </Row>
      <Row label="Буквы клавиш на кнопках (showShortcut; на сенсорных скрыты) и неактивная с причиной (disabledReason: нажмите)">
        <IconButton icon="mic" label="Микрофон" shortcut="M" variant="soft" shape="round" size="lg" showShortcut />
        <IconButton icon="headphones" label="Звук" shortcut="D" variant="soft" shape="round" size="lg" showShortcut />
        <IconButton icon="mic-off" label="Микрофон" shortcut="M" variant="danger" shape="round" size="lg" showShortcut />
        <IconButton
          icon="screen-share"
          label="Показ экрана: только хост"
          shortcut="S"
          variant="soft"
          shape="round"
          size="lg"
          showShortcut
          disabled
          disabledReason="Показывать экран сейчас может только хост"
        />
      </Row>
      <Row label="Поверх видео — scrim (фиксированные цвета, без blur); в плашке громкости — scrim-ghost и Slider variant=scrim">
        <div className="relative h-28 w-full max-w-md overflow-hidden rounded-card">
          <FakeScreen className="absolute inset-0" />
          <div className="absolute bottom-3 right-3 flex gap-2">
            <div className="flex h-10 items-center gap-1 rounded-full bg-[rgb(0_0_0/0.55)] pl-1 pr-3">
              <IconButton
                icon={volume === 0 ? "volume-off" : "volume"}
                label="Звук показа"
                variant="scrim-ghost"
                size="sm"
                shape="round"
                onClick={() => setVolume((v) => (v === 0 ? 100 : 0))}
              />
              <Slider
                aria-label="Громкость показа"
                value={volume}
                onValueChange={setVolume}
                max={200}
                marks={[100]}
                snap={4}
                showValue={false}
                formatValue={(v) => `${v}%`}
                variant="scrim"
                wrapperClassName="w-24"
              />
            </div>
            <IconButton icon="info" label="Качество показа" variant="scrim" shape="round" />
            <IconButton icon="maximize" label="Во весь экран" shortcut="F" variant="scrim" shape="round" />
          </div>
        </div>
      </Row>
      <Row label="Сплит-кнопка дока: шеврон size=split (24×48) variant=quiet + кнопка lg">
        <div className="flex items-center rounded-full bg-wash-1 pl-1">
          <IconButton icon="chevron-up" label="Выбрать микрофон" size="split" variant="quiet" tooltip={false} />
          <IconButton icon="mic" label="Микрофон" hint="Выключить микрофон" shortcut="M" variant="soft" size="lg" shape="round" pressed />
        </div>
        <div className="flex items-center rounded-full bg-wash-1 pl-1">
          <IconButton icon="chevron-up" label="Выбрать наушники" size="split" variant="quiet" tooltip={false} />
          <IconButton icon="headphones-off" label="Звук" hint="Включить звук" shortcut="D" variant="danger" size="lg" shape="round" pressed />
        </div>
      </Row>
      <Row label="Док — состояния микрофона: включён и говорит · выключен · рация ждёт · рация в эфире · «Реакции»">
        {/* Док шире узкого окна (в комнате там полоса без зазоров): здесь — своя прокрутка. */}
        <div className="-mx-1 flex max-w-[calc(100%+8px)] flex-col gap-4 overflow-x-auto p-1">
          <Dock floating={false} mic="on" speaking unread={2} />
          <Dock floating={false} mic="off" deafened />
          <Dock floating={false} mic="ptt-idle" sharing />
          <Dock floating={false} mic="ptt-talk" chatOpen showKeys />
        </div>
      </Row>
    </Section>
  );
}

function FieldsSection() {
  return (
    <Section id="fields" title="Поля" lead="Подпись всегда над полем, подсказка или ошибка — под ним. Плейсхолдер подпись не заменяет.">
      <div className="grid gap-6 md:grid-cols-2">
        <TextField label="Ваш ник" defaultValue="Саня" hint="Так вас увидят друзья" />
        <TextField label="Пароль комнаты" type="password" defaultValue="12" error="Неверный пароль. Спросите у того, кто позвал." />
        <TextField label="Код или ссылка" icon="hash" placeholder="K7QMP4" size="lg" />
        <TextField
          label="Ссылка-приглашение"
          readOnly
          defaultValue="club.game-room.space/room/K7QMP4"
          suffix={<IconButton icon="copy" label="Скопировать" size="sm" variant="soft" />}
        />
        <Select
          label="Микрофон"
          icon="mic"
          defaultValue="a"
          options={[
            { value: "a", label: "Микрофон (HyperX Cloud II)" },
            { value: "b", label: "Realtek High Definition Audio" },
          ]}
        />
        <Select label="Выключенное поле" disabled options={[{ value: "a", label: "Недоступно в Firefox" }]} hint="Выбор вывода звука Firefox не умеет" />
      </div>
    </Section>
  );
}

function ChoiceSection() {
  const [sw, setSw] = useState(true);
  const [seg, setSeg] = useState<GateMode>("manual");
  const [choice, setChoice] = useState("smooth");
  const [tab, setTab] = useState("voice");
  const [vtab, setVtab] = useState("voice");
  return (
    <Section id="choice" title="Выбор" lead="Переключатель включён — «чернильный», а не зелёный: зелёный signal значит только «передаёт».">
      <Row label="Switch: вкл · выкл · маленький · выключенный">
        <Switch checked={sw} onCheckedChange={setSw} aria-label="Шумоподавление" />
        <Switch checked={!sw} onCheckedChange={(v) => setSw(!v)} aria-label="Эхоподавление" />
        <Switch size="sm" checked={sw} onCheckedChange={setSw} aria-label="Слышать себя" />
        <Switch checked={false} onCheckedChange={() => {}} disabled aria-label="Недоступно" />
      </Row>
      <Card tone="outline" padding="none" className="max-w-xl divide-y divide-line px-4">
        <SettingRow htmlFor="demo-ns" title="Шумоподавление" description="Убирает гул кулеров, клавиатуру и фон" control={<Switch id="demo-ns" checked={sw} onCheckedChange={setSw} />} />
        <SettingRow title="Режим порога" control={<SegmentedControl label="Режим порога" size="sm" value={seg} onValueChange={setSeg} options={[{ value: "auto", label: "Авто" }, { value: "manual", label: "Вручную" }, { value: "off", label: "Выкл" }]} />} />
      </Card>
      <Row label="ChoiceGroup — когда у вариантов есть описание">
        <ChoiceGroup
          label="Качество показа"
          className="w-full max-w-xl"
          value={choice}
          onValueChange={setChoice}
          options={[
            { value: "light", title: "Лёгкий", meta: "720p · 60 к/с", description: "Слабый интернет или ноутбук." },
            { value: "smooth", title: "Игры", meta: "1080p · 60 к/с", description: "Плавно и чётко. Нужно ~6 Мбит/с отдачи." },
            { value: "text", title: "Текст", meta: "1080p · 15 к/с", description: "Код и документы: резкость важнее плавности." },
          ]}
        />
      </Row>
      <div className="grid gap-8 md:grid-cols-2">
        <Row label="Tabs — горизонтальные">
          <Tabs value={tab} onValueChange={setTab} className="w-full">
            <TabList label="Пример вкладок">
              <Tab value="voice" icon="mic">
                Голос
              </Tab>
              <Tab value="screen" icon="monitor">
                Экран
              </Tab>
              <Tab value="keys" icon="keyboard">
                Клавиши
              </Tab>
            </TabList>
            <TabPanel value="voice" className="pt-4 text-body text-ink-2">
              Раздел «Голос»
            </TabPanel>
            <TabPanel value="screen" className="pt-4 text-body text-ink-2">
              Раздел «Экран»
            </TabPanel>
            <TabPanel value="keys" className="pt-4 text-body text-ink-2">
              Раздел «Клавиши»
            </TabPanel>
          </Tabs>
        </Row>
        <Row label="Tabs — вертикальные (меню настроек)">
          <Tabs value={vtab} onValueChange={setVtab} orientation="vertical" className="flex w-full gap-4">
            <TabList label="Разделы" className="w-44">
              <Tab value="voice" icon="mic">
                Голос
              </Tab>
              <Tab value="screen" icon="monitor">
                Экран
              </Tab>
              <Tab value="sounds" icon="bell">
                Звуки
              </Tab>
            </TabList>
            <TabPanel value={vtab} className="text-body text-ink-2">
              Содержимое раздела
            </TabPanel>
          </Tabs>
        </Row>
      </div>
    </Section>
  );
}

function useDemoVoice(): () => number {
  const t0 = useRef(0);
  useEffect(() => {
    t0.current = performance.now();
  }, []);
  return () => {
    const t = (performance.now() - t0.current) / 1000;
    const s = Math.max(0, Math.sin(t * 7.3) * 0.5 + Math.sin(t * 2.1) * 0.6);
    return Math.sin(t * 0.9) > -0.3 && s > 0.15 ? -36 + s * 24 : -55 + Math.sin(t * 11) * 2;
  };
}

function LevelSection() {
  const [vol, setVol] = useState(100);
  const [gain, setGain] = useState(140);
  const [th, setTh] = useState(-42);
  const getLevel = useDemoVoice();
  return (
    <Section
      id="level"
      title="Ползунок и уровень"
      lead="Полоса уровня — главный инструмент настройки голоса. Серым — что отсекается порогом, signal — что уходит в эфир, caution — близко к перегрузу. Порог тянется прямо по полосе."
    >
      <div className="grid gap-8 md:grid-cols-2">
        <Slider label="Громкость Ники для вас" value={vol} onValueChange={setVol} max={200} marks={[100]} snap={4} formatValue={(v) => `${v}%`} iconStart="volume-low" iconEnd="volume" />
        <Slider label="Громкость микрофона" value={gain} onValueChange={setGain} max={200} step={5} marks={[100]} snap={4} formatValue={(v) => `${v}%`} />
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Row label="Вручную — живой голос, порог тянется (стрелки ←/→ тоже)" className="block">
          <LevelMeter getLevelDb={getLevel} thresholdDb={th} onThresholdChange={setTh} />
        </Row>
        <Row label="Вручную — статичный кадр: −24 дБ, порог −42 дБ" className="block">
          <LevelMeter levelDb={-24} thresholdDb={-42} onThresholdChange={() => {}} />
        </Row>
        <Row label="Авто — маркер показан пунктиром, не тянется" className="block">
          <LevelMeter levelDb={-31} thresholdDb={-38} mode="auto" />
        </Row>
        <Row label="Выкл — проходит всё; перегруз выше −6 дБ" className="block">
          <LevelMeter levelDb={-3} mode="off" />
        </Row>
      </div>
    </Section>
  );
}

function AvatarSection() {
  const [lvl, setLvl] = useState(0.6);
  return (
    <Section
      id="avatar"
      title="Аватар и «говорит»"
      lead="В комнате человек — Румик: за столом во весь рост, а в списке, ленте под сценой, мини-комнате, чате, тостах и чипе показа — головой (RumikAvatar) с его рисунком. Кружок Avatar остался только там, где Румиков выключили флагом rumik_table. Кольцо signal с зазором видно боковым зрением; у кружка оно «дышит» с голосом (transform/opacity). В тишине ничего не движется. Значок в углу — мьют, звук выкл, заглушён хостом, рация."
    >
      <Row label="Размеры xs 24 · sm 32 · md 44 · lg 72 · xl 96">
        {(["xs", "sm", "md", "lg", "xl"] as const).map((s, i) => (
          <Avatar key={s} name={PEOPLE[i % PEOPLE.length].name} colorIndex={PEOPLE[i % PEOPLE.length].colorIndex} size={s} />
        ))}
      </Row>
      <Row label="Состояния: тишина · говорит тихо · громко · мьют · звук выкл · заглушён хостом · рация" className="flex flex-wrap items-center gap-8">
        <Avatar name="Ника" colorIndex={PEOPLE[1].colorIndex} size="lg" />
        <Avatar name="Тёма" colorIndex={PEOPLE[0].colorIndex} size="lg" speaking level={0.15} />
        <Avatar name="Тёма" colorIndex={PEOPLE[0].colorIndex} size="lg" speaking level={1} />
        <Avatar name="Лёха" colorIndex={PEOPLE[2].colorIndex} size="lg" status="muted" />
        <Avatar name="Даня Котов" colorIndex={PEOPLE[3].colorIndex} size="lg" status="deafened" />
        <Avatar name="Гоша" size="lg" status="forceMuted" />
        <Avatar name="Саня" colorIndex={PEOPLE[4].colorIndex} size="lg" status="ptt" />
      </Row>
      <Row label="Сила кольца от громкости">
        <Avatar name="Тёма" colorIndex={PEOPLE[0].colorIndex} size="xl" speaking level={lvl} />
        <Slider aria-label="Громкость голоса" value={Math.round(lvl * 100)} onValueChange={(v) => setLvl(v / 100)} formatValue={(v) => `${v}%`} wrapperClassName="w-56" showValue={false} />
      </Row>
      <Row label="Голова Румика RumikAvatar (@/components/ui/Avatar): та же шкала, «говорит» — кольцо вокруг плитки без волны, мьют — значок в углу (от 40 px ещё и глаза)" className="flex flex-wrap items-center gap-8">
        <RumikAvatar name="Ника" colorIndex={PEOPLE[1].colorIndex} size="lg" />
        <RumikAvatar name="Тёма" colorIndex={PEOPLE[0].colorIndex} size="lg" speaking />
        <RumikAvatar name="Лёха" colorIndex={PEOPLE[2].colorIndex} size="lg" status="muted" />
        <RumikAvatar name="Даня Котов" colorIndex={PEOPLE[3].colorIndex} size="lg" status="deafened" />
        <RumikAvatar name="Гоша" size="lg" status="forceMuted" />
        <RumikAvatar name="Саня" paint={SAMPLE_PAINT} size="lg" status="ptt" />
        <RumikAvatar name="Саня" paint={SAMPLE_PAINT} size="sm" speaking />
      </Row>
      <Row label='Стопка: головы (по умолчанию) · на приподнятой поверхности · известен только хост (total) · кружки variant="initials" (флаг rumik_table выключен)'>
        <AvatarStack people={PEOPLE} max={4} size="md" />
        <Card padding="sm" className="flex items-center gap-3">
          <AvatarStack people={PEOPLE.slice(0, 3)} size="sm" surface="raised" />
          <span className="text-label text-ink-2">Тёма, Ника и Лёха уже тут</span>
        </Card>
        <AvatarStack people={[PEOPLE[0]]} total={5} max={1} size="sm" />
        <AvatarStack people={PEOPLE} max={4} size="md" variant="initials" />
      </Row>
      <Row label='Мини-стол TablePreview: стол под углом из Румиков (me — внизу и «· вы», paint — рисунок) · пустой стол крупнее · variant="avatars" — запасной круглый (контейнер с [container-type:size])' className="flex flex-wrap items-start gap-8">
        <div className="h-[300px] w-full max-w-[440px] [container-type:size]">
          <div className="grid h-full place-items-center">
            <TablePreview
              people={PEOPLE.slice(0, 5).map((p, i) => ({
                name: p.name,
                colorIndex: p.colorIndex,
                host: p.host,
                me: p.me,
                paint: p.me ? SAMPLE_PAINT : null,
                speaking: i === 0,
                status: i === 2 ? "muted" : null,
              }))}
              center={<span className="font-brand text-[15px] tracking-[0.16em] text-ink-2">K7QMP4</span>}
              label="Тёма, Ника, Лёха и Даня уже в комнате"
            />
          </div>
        </div>
        <div className="h-[300px] w-full max-w-[440px] [container-type:size]">
          <div className="grid h-full place-items-center">
            <TablePreview
              people={[]}
              center={
                <span className="flex flex-col items-center gap-1">
                  <span className="text-caption text-ink-3">код комнаты</span>
                  <span className="font-brand text-[15px] tracking-[0.16em] text-ink-2">K7QMP4</span>
                </span>
              }
            />
          </div>
        </div>
        <div className="h-[320px] w-full max-w-[360px] [container-type:size]">
          <div className="grid h-full place-items-center">
            <TablePreview
              variant="avatars"
              people={PEOPLE.slice(0, 4).map((p, i) => ({
                name: p.name,
                colorIndex: p.colorIndex,
                host: p.host,
                speaking: i === 0,
                level: 0.7,
                status: i === 2 ? "muted" : null,
              }))}
            />
          </div>
        </div>
      </Row>
    </Section>
  );
}

function MarksSection() {
  return (
    <Section id="marks" title="Метки" lead="Бейдж — короткий статус по смыслу. Kbd — клавиша, как настоящая. Связь — серая, пока всё хорошо.">
      <Row label="Badge soft · solid · outline">
        <Badge tone="signal" variant="solid" caps>
          Эфир
        </Badge>
        <Badge tone="signal" icon="monitor" caps size="sm">
          Экран
        </Badge>
        <Badge tone="crown" icon="crown">
          Хост
        </Badge>
        <Badge tone="alert" icon="mic-off">
          Микрофон выкл
        </Badge>
        <Badge tone="caution" icon="lock">
          Вход закрыт
        </Badge>
        <Badge>6 из 6</Badge>
        <Badge variant="outline">Только хост</Badge>
        <CountBadge count={3} />
        <CountBadge count={14} />
      </Row>
      <Row label="Kbd">
        <Kbd>M</Kbd>
        <Kbd>D</Kbd>
        <Kbd>Space</Kbd>
        <Kbd>Enter</Kbd>
        <Kbd size="sm">Esc</Kbd>
        <span className="text-label text-ink-2">
          Держите <Kbd size="sm">V</Kbd>, чтобы говорить
        </span>
      </Row>
      <Row label="Связь (SignalBars quality=…)">
        {(
          [
            ["excellent", "отличная"],
            ["good", "хорошая"],
            ["poor", "слабая"],
            ["lost", "нет связи"],
            ["unknown", "проверяем"],
          ] as const
        ).map(([q, text]) => (
          <span key={q} className="flex items-center gap-2 rounded-control border border-line px-3 py-2 text-label text-ink-2">
            <SignalBars quality={q} /> {text}
          </span>
        ))}
      </Row>
      <Row label="QR-код (QrCode) — тёмный на белом в обеих темах">
        <QrCode value="https://club.game-room.space/room/K7QMP4" label="QR-код ссылки на комнату K7QMP4" size={136} />
      </Row>
    </Section>
  );
}

function MessagesSection() {
  return (
    <Section id="messages" title="Сообщения и состояния" lead="Плашка — то, что держится, пока причина не уйдёт. Тост — мимолётное событие. Пустое состояние всегда предлагает действие.">
      <div className="grid gap-3 md:grid-cols-2">
        <InlineAlert tone="info" title="Сообщения видно с момента входа">
          История до вас не сохраняется.
        </InlineAlert>
        <InlineAlert tone="success" title="Ссылка скопирована">
          Отправьте её друзьям.
        </InlineAlert>
        <InlineAlert tone="caution" title="Клавиши работают, только когда окно активно" onDismiss={() => {}}>
          В игре браузер их не слышит.
        </InlineAlert>
        <InlineAlert
          tone="alert"
          title="Нет доступа к микрофону"
          action={
            <Button size="sm" variant="secondary">
              Как включить
            </Button>
          }
        >
          Вас не слышно. Разрешите микрофон у адресной строки.
        </InlineAlert>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Card padding="lg" className="grid min-h-64 place-items-center">
          <EmptyState
            icon="users"
            title="Пока тут только вы"
            description="Отправьте ссылку друзьям, они зайдут без регистрации."
            actions={
              <Button variant="primary" icon="link">
                Скопировать ссылку
              </Button>
            }
          />
        </Card>
        <Card padding="lg" className="flex flex-col gap-4">
          <p className="text-label text-ink-3">Загрузка: крутилка в кнопке, скелет вместо списка</p>
          <div className="flex items-center gap-3 text-body text-ink-2">
            <Spinner size={18} /> Подключаемся к комнате…
          </div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-8 rounded-full" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3 w-2/5" />
                <Skeleton className="h-2.5 w-1/4" />
              </div>
            </div>
          ))}
        </Card>
      </div>
      <Card padding="lg" className="grid min-h-80 place-items-center">
        <StateScreen
          icon="search"
          title="Комнаты K7QMP4 нет"
          titleAs="h2"
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
          StateScreen — экран-тупик: главное действие чинит ситуацию, запасное уводит. 404 и ошибки — на нём же.
        </StateScreen>
      </Card>
      <Card padding="lg" className="grid min-h-80 place-items-center">
        <StateScreen
          visual={<Rumik colors={[6, 7, 8, 5]} sticker extra="q" look={[3, -2]} tilt={-6} />}
          title="Такой страницы нет"
          titleAs="h2"
          actions={
            <>
              <Button variant="primary" block>
                На главную
              </Button>
              <Button variant="ghost" block>
                Открытые комнаты
              </Button>
            </>
          }
        >
          visual — Румик вместо значка в круге (бренд-слой, §8): 404, ошибки, «Связь потеряна», «Вы вышли». Глаза
          подсказывают, что случилось.
        </StateScreen>
      </Card>
    </Section>
  );
}

function FloatingSection() {
  const [dialog, setDialog] = useState(false);
  const [tallDialog, setTallDialog] = useState(false);
  const [doneDialog, setDoneDialog] = useState(false);
  const [pop, setPop] = useState(false);
  const [panel, setPanel] = useState(false);
  const [panelVolume, setPanelVolume] = useState(100);
  const popRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLButtonElement>(null);
  return (
    <Section
      id="floating"
      title="Всплывающее"
      lead="Меню, поповеры, тултипы и диалоги — в top layer браузера: поверх всего без z-index. Esc и клик мимо закрывают, фокус возвращается туда, откуда открыли."
    >
      <Row>
        <Tooltip content="Обычная подсказка">
          <Button variant="secondary">Наведите</Button>
        </Tooltip>
        <Menu
          label="Действия с комнатой"
          trigger={
            <Button variant="secondary" iconRight="chevron-down">
              Меню
            </Button>
          }
        >
          <MenuItem icon="link">Скопировать ссылку</MenuItem>
          <MenuItem icon="hash" hint="K7QMP4">
            Скопировать код
          </MenuItem>
          <MenuSeparator />
          <MenuLabel>Вы хост</MenuLabel>
          <MenuItem icon="shield">Настройки комнаты</MenuItem>
          <MenuItem icon="lock" checked={false} keepOpen>
            Закрыть вход
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon="leave" tone="danger">
            Выйти из комнаты
          </MenuItem>
        </Menu>
        <Button ref={popRef} variant="primary" icon="user-plus" onClick={() => setPop((v) => !v)}>
          Пригласить
        </Button>
        <Popover open={pop} onOpenChange={setPop} anchor={popRef} align="start" aria-label="Пригласить друзей" className="w-[360px] p-4">
          <InvitePanel />
        </Popover>
        <Button variant="secondary" onClick={() => setDialog(true)}>
          Диалог
        </Button>
        <Dialog
          open={dialog}
          onOpenChange={setDialog}
          title="Выйти из комнаты?"
          description="Вы хост. Права перейдут Нике, она в комнате дольше всех."
          size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialog(false)}>
                Остаться
              </Button>
              <Button variant="danger" icon="leave" onClick={() => setDialog(false)}>
                Выйти
              </Button>
            </>
          }
        >
          <p className="text-body text-ink-2">Комната останется открытой, пока в ней кто-то есть.</p>
        </Dialog>
      </Row>
      <Row label="Popover role=dialog с PopoverItem — пункты по Tab (панель участника) · диалог с высотой, заданной классом: прокручивается тело, низ виден · headerAction — своя кнопка в шапке вместо крестика (окно, которое сохраняет само)">
        <Button ref={panelRef} variant="secondary" icon="user" onClick={() => setPanel((v) => !v)}>
          Панель участника
        </Button>
        <Popover
          open={panel}
          onOpenChange={setPanel}
          anchor={panelRef}
          triggerRef={panelRef}
          align="start"
          aria-label="Участник Ника"
        >
          <div className="flex w-72 max-w-full flex-col">
            <div className="flex flex-col gap-1 px-2.5 py-3">
              <Slider
                label="Громкость для вас"
                value={panelVolume}
                onValueChange={setPanelVolume}
                max={200}
                step={5}
                marks={[100]}
                snap={4}
                formatValue={(v) => `${v}%`}
              />
            </div>
            <div className="flex flex-col border-t border-line pt-1.5">
              <MenuLabel>Вы хост</MenuLabel>
              <PopoverItem icon="crown">Сделать хостом</PopoverItem>
              <PopoverItem icon="mic-off" busy disabled>
                Выключить микрофон
              </PopoverItem>
              <PopoverItem icon="chat-off">Запретить чат</PopoverItem>
              <div className="-mx-1.5 my-1.5 h-px bg-line" />
              <PopoverItem icon="user-x" tone="danger">
                Выгнать…
              </PopoverItem>
            </div>
          </div>
        </Popover>
        <Button variant="secondary" onClick={() => setTallDialog(true)}>
          Диалог с высотой
        </Button>
        <Dialog
          open={tallDialog}
          onOpenChange={setTallDialog}
          title="Высота задана классом"
          description="sm:h-[min(88dvh,420px)] — как у настроек. Прокрутите до конца: последняя строка видна целиком."
          className="sm:h-[min(88dvh,420px)]"
        >
          <ol className="flex list-decimal flex-col gap-3 pl-7 text-body text-ink-2">
            {Array.from({ length: 16 }, (_, i) => (
              <li key={i}>{i === 15 ? "Последняя строка: низ прокрутки не обрезан." : `Строка ${i + 1}`}</li>
            ))}
          </ol>
        </Dialog>
        <Button variant="secondary" icon="brush" onClick={() => setDoneDialog(true)}>
          «Готово» в шапке
        </Button>
        <Dialog
          open={doneDialog}
          onOpenChange={setDoneDialog}
          title="Ваш Румик"
          size="sm"
          headerAction={
            <Button size="sm" variant="secondary" onClick={() => setDoneDialog(false)}>
              Готово
            </Button>
          }
        >
          <p className="text-body text-ink-2">
            Изменения сохраняются сами, поэтому вместо крестика — маленькая «Готово». Esc и клик по подложке закрывают как
            обычно.
          </p>
        </Dialog>
      </Row>
      <Row label='Тосты: здесь внизу слева, в комнате сверху слева под шапкой. «Почему неактивна» — сразу, без очереди. Человек слева — голова Румика (с рисунком — paint), без Румиков — кружок person.variant="initials"'>
        <Button
          size="sm"
          onClick={() => toast({ title: "Ника", description: "теперь в комнате", person: { name: "Ника", colorIndex: PEOPLE[1].colorIndex } })}
        >
          Вошла
        </Button>
        <Button size="sm" onClick={() => toast({ title: "Тёма теперь хост", icon: "crown" })}>
          Права
        </Button>
        <Button size="sm" onClick={() => toast({ title: "Вход закрыт", description: "Новые люди не смогут зайти", icon: "lock", tone: "caution" })}>
          Замок
        </Button>
        <Button
          size="sm"
          onClick={() =>
            toast({
              title: "Тёма показывает экран",
              icon: "screen-share",
              tone: "signal",
              action: { label: "Смотреть", onClick: () => {} },
            })
          }
        >
          Экран
        </Button>
        <Button size="sm" onClick={() => toast({ tone: "alert", title: "Не получилось выгнать", description: "Участник уже вышел" })}>
          Ошибка
        </Button>
        <Button
          size="sm"
          onClick={() =>
            toast({ title: "Лёха", description: "секунду, чай", person: { name: "Лёха", colorIndex: PEOPLE[2].colorIndex }, action: { label: "Ответить", onClick: () => {} } })
          }
        >
          Сообщение
        </Button>
        <Button
          size="sm"
          onClick={() =>
            toast({ title: "Саня", description: "теперь в комнате", person: { name: "Саня", colorIndex: PEOPLE[4].colorIndex, paint: SAMPLE_PAINT } })
          }
        >
          С рисунком
        </Button>
        <Button
          size="sm"
          onClick={() =>
            toast({
              title: "Даня Котов",
              description: "больше не в комнате",
              person: { name: "Даня Котов", colorIndex: PEOPLE[3].colorIndex, variant: "initials" },
            })
          }
        >
          Кружок
        </Button>
      </Row>
    </Section>
  );
}

function IconsSection() {
  return (
    <Section id="icons" title="Иконки" lead={`${ICON_NAMES.length} иконок, геометрия Lucide (ISC), обводка 1.75–2. Только то, что нужно комнате.`}>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2">
        {ICON_NAMES.map((n) => (
          <li key={n} className="flex flex-col items-center gap-2 rounded-card border border-line px-2 py-3">
            <Icon name={n} size={22} className="text-ink" />
            <span className="font-code text-[11px] text-ink-3">{n}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function LogoSection() {
  return (
    <Section
      id="logo"
      title="Знак и логотип"
      lead="Буквы — своя монолинейная геометрия. Второе «о» в «room» — сигнальный круг: в комнате кто-то говорит. Знак — кольцо и круг внахлёст с вырезом, как стопка аватаров. Файлы — public/brand/."
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Card padding="lg" className="grid min-h-40 place-items-center">
          <Logo variant="lockup" height={40} className="text-ink" />
        </Card>
        <Card padding="lg" className="grid min-h-40 place-items-center">
          <Logo variant="wordmark" height={30} className="text-ink" />
        </Card>
        <Card padding="lg" className="flex min-h-40 items-center justify-center gap-6">
          <Logo variant="mark" height={64} className="text-ink" />
          <Logo variant="mark" height={32} className="text-ink" />
          <Logo variant="mark" height={16} className="text-ink" />
          {/* eslint-disable-next-line @next/next/no-img-element -- показываем сам файл иконки */}
          <img src="/brand/app-icon.svg" width={48} height={48} alt="Иконка приложения" />
        </Card>
      </div>
    </Section>
  );
}

function RumikSection() {
  return (
    <Section
      id="rumik"
      title="Румик"
      lead="Маскот: один SVG, поза, глаза, шапка и цвета — параметры. На витрине он украшение, в комнате — сам человек (место за столом, голова в списке, «Ваш Румик» в лобби), в пустых состояниях — картинка. Украшений в рабочих экранах нет (DESIGN_SYSTEM.md §8)."
    >
      <Row label="Витрина: поза, шапка, наклейка, глаза · glow — «говорит»">
        <div className="flex flex-wrap items-end gap-x-10 gap-y-6">
          <Rumik colors={[6, 5, 4, 2]} pose="wave" hat="cap" sticker size={120} label="Румик машет рукой" />
          <Rumik colors={[2, 1, 9, 8]} pose="sit" hat="crown" sticker size={120} look={[2, 0]} />
          <Rumik colors={[4, 3, 5, 6]} eyes="sleep" extra="zzz" sticker tilt={-5} size={120} />
          <Rumik colors={[6, 5, 4, 2]} glow size={120} />
        </div>
      </Row>
      <Row label='paint — рисунок человека (PNG слоя краски из рисовалки) поверх colors="white": едет вместе с руками и ногами · frame="head" — голова для миниатюр'>
        <div className="flex flex-wrap items-end gap-x-10 gap-y-6">
          <Rumik colors="white" paint={SAMPLE_PAINT} size={120} label="Румик с рисунком" />
          <Rumik colors="white" paint={SAMPLE_PAINT} pose="cheer" size={120} />
          <Rumik colors="white" paint={SAMPLE_PAINT} pose="sit" glow size={120} />
          <span className="block overflow-hidden rounded-item border border-line bg-wash-1">
            <Rumik colors="white" paint={SAMPLE_PAINT} frame="head" size={64} />
          </span>
          <span className="mb-3 block size-10 rounded-item border border-line bg-wash-1 p-1">
            <Rumik colors={[6, 5, 4, 2]} hat="cap" frame="head" />
          </span>
        </div>
      </Row>
      <div className="flex flex-wrap gap-2">
        <Link href="/design/rumik" className={buttonClass({ variant: "secondary", size: "sm" })}>
          Все позы, глаза, головы и жесты
          <Icon name="arrow-right" size={16} />
        </Link>
        <Link href="/design/editor" className={buttonClass({ variant: "secondary", size: "sm" })}>
          <Icon name="brush" size={16} />
          Рисовалка
        </Link>
      </div>
    </Section>
  );
}

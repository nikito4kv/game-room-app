"use client";

// Настройки (голос, экран, клавиши, звуки) — макет. Эталон состава и
// порядка блоков для фазы 2.

import { useEffect, useRef, useState } from "react";
import {
  Button,
  ChoiceGroup,
  Dialog,
  InlineAlert,
  Kbd,
  LevelMeter,
  SegmentedControl,
  Select,
  SettingRow,
  Slider,
  Switch,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TextField,
  formatDb,
  type GateMode,
} from "@/components/ui";

type SettingsTab = "voice" | "screen" | "keys" | "sounds";

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h3 className="text-title text-ink">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Демо-источник уровня: «голос» с паузами, чтобы полоса жила в макете. */
function useFakeVoice(): () => number {
  const t0 = useRef(0);
  useEffect(() => {
    t0.current = performance.now();
  }, []);
  return () => {
    const t = (performance.now() - t0.current) / 1000;
    const syllables = Math.max(0, Math.sin(t * 7.3) * 0.5 + Math.sin(t * 2.1) * 0.6);
    const phrase = Math.sin(t * 0.9) > -0.3 ? 1 : 0;
    const noise = -54 + Math.sin(t * 13) * 2;
    return phrase && syllables > 0.15 ? -36 + syllables * 22 : noise;
  };
}

function VoiceTab({ live }: { live: boolean }) {
  const [gain, setGain] = useState(100);
  const [mode, setMode] = useState<GateMode>("manual");
  const [threshold, setThreshold] = useState(-42);
  const [ns, setNs] = useState(true);
  const [ec, setEc] = useState(true);
  const [agc, setAgc] = useState(false);
  const [loop, setLoop] = useState(false);
  const [out, setOut] = useState(80);
  const getLevel = useFakeVoice();
  return (
    <div className="flex flex-col gap-8">
      <Section title="Микрофон">
        <Select
          label="Устройство"
          icon="mic"
          defaultValue="hyperx"
          options={[
            { value: "default", label: "Как в Windows" },
            { value: "hyperx", label: "Микрофон (HyperX Cloud II)" },
            { value: "realtek", label: "Realtek High Definition Audio" },
          ]}
        />
        <Slider
          label="Громкость микрофона"
          value={gain}
          onValueChange={setGain}
          max={200}
          step={5}
          marks={[100]}
          snap={4}
          formatValue={(v) => `${v}%`}
        />
      </Section>

      <Section
        title="Чувствительность"
        aside={
          <SegmentedControl
            label="Режим порога"
            size="sm"
            value={mode}
            onValueChange={setMode}
            options={[
              { value: "auto", label: "Авто" },
              { value: "manual", label: "Вручную" },
              { value: "off", label: "Выкл" },
            ]}
          />
        }
      >
        <div className="rounded-card border border-line bg-sunken px-4 pb-3 pt-4">
          <LevelMeter
            getLevelDb={live ? getLevel : undefined}
            levelDb={live ? undefined : -24}
            mode={mode}
            thresholdDb={threshold}
            onThresholdChange={mode === "manual" ? setThreshold : undefined}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="text-label text-ink-2">
              {mode === "off"
                ? "Передаётся всё, что слышит микрофон."
                : mode === "auto"
                  ? `Порог подбирается сам по вашему голосу: сейчас ${formatDb(threshold)}.`
                  : `Вас слышно, когда полоса заходит за отметку: ${formatDb(threshold)}.`}
            </p>
            <Button size="sm" variant="secondary" icon="activity" disabled={mode === "off"}>
              Калибровать
            </Button>
          </div>
        </div>
        <p className="text-caption text-ink-3">
          В шумном клубе поднимите порог, чтобы соседей не было слышно, пока вы молчите.
        </p>
      </Section>

      <Section title="Обработка">
        <div className="divide-y divide-line rounded-card border border-line px-4">
          <SettingRow
            htmlFor="ns"
            title="Шумоподавление"
            description="Убирает гул кулеров, клавиатуру и фон"
            control={<Switch id="ns" checked={ns} onCheckedChange={setNs} />}
          />
          <SettingRow
            htmlFor="ec"
            title="Эхоподавление"
            description="Нужно, если звук идёт из колонок, а не из наушников"
            control={<Switch id="ec" checked={ec} onCheckedChange={setEc} />}
          />
          <SettingRow
            htmlFor="agc"
            title="Автогромкость"
            description="Выравнивает громкость, но в паузах вытягивает чужие голоса"
            control={<Switch id="agc" checked={agc} onCheckedChange={setAgc} />}
          />
          <SettingRow
            htmlFor="loop"
            title="Слышать себя"
            description="Наденьте наушники, иначе будет эхо"
            control={<Switch id="loop" checked={loop} onCheckedChange={setLoop} />}
          />
        </div>
      </Section>

      <Section title="Звук">
        <Select
          label="Куда выводить"
          icon="headphones"
          defaultValue="hyperx"
          options={[
            { value: "default", label: "Как в Windows" },
            { value: "hyperx", label: "Наушники (HyperX Cloud II)" },
            { value: "realtek", label: "Динамики (Realtek)" },
          ]}
        />
        <Slider label="Общая громкость" value={out} onValueChange={setOut} formatValue={(v) => `${v}%`} />
      </Section>
    </div>
  );
}

function ScreenTab() {
  const [q, setQ] = useState<"light" | "smooth" | "max" | "text">("smooth");
  return (
    <div className="flex flex-col gap-6">
      <Section title="Качество показа">
        <ChoiceGroup
          label="Качество показа"
          value={q}
          onValueChange={setQ}
          options={[
            { value: "light", title: "Лёгкий", meta: "720p · 60 к/с", description: "Слабый интернет или ноутбук. Нужно ~3,5 Мбит/с отдачи." },
            { value: "smooth", title: "Игры", meta: "1080p · 60 к/с", description: "Плавно и чётко. Нужно ~6 Мбит/с отдачи." },
            { value: "max", title: "Максимум", meta: "1440p · 60 к/с", description: "Мощный ПК и быстрый интернет. Только один такой показ за раз." },
            { value: "text", title: "Текст", meta: "1080p · 15 к/с", description: "Код, документы, таблицы: резкость важнее плавности." },
          ]}
        />
        <InlineAlert tone="info" title="Как показать игру со звуком">
          Запустите игру в окне без рамки, выберите «Весь экран» и отметьте «Поделиться системным звуком».
        </InlineAlert>
      </Section>
    </div>
  );
}

const BINDS: [string, string][] = [
  ["Микрофон вкл/выкл", "M"],
  ["Звук вкл/выкл", "D"],
  ["Показ экрана", "S"],
  ["Открыть чат", "Enter"],
];

function KeysTab() {
  const [mode, setMode] = useState<"open" | "ptt">("open");
  const [hints, setHints] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      <Section title="Режим голоса">
        <SegmentedControl
          label="Режим голоса"
          block
          value={mode}
          onValueChange={setMode}
          options={[
            { value: "open", label: "Открытый микрофон", icon: "mic" },
            { value: "ptt", label: "Рация", icon: "radio" },
          ]}
        />
        <InlineAlert tone="caution" title="Клавиши работают, только когда окно комнаты активно">
          В игре браузер их не слышит, поэтому во время игры включайте открытый микрофон с шумоподавлением.
        </InlineAlert>
      </Section>
      <Section title="Клавиши">
        <div className="divide-y divide-line rounded-card border border-line px-4">
          {[...BINDS, ...(mode === "ptt" ? ([["Рация (держать)", "V"]] as [string, string][]) : [])].map(([title, key]) => (
            <SettingRow
              key={title}
              title={title}
              control={
                <button
                  type="button"
                  aria-label={`Клавиша для «${title}»: ${key}. Нажмите, чтобы изменить`}
                  className="rounded-key transition-transform duration-140 hover:scale-105"
                >
                  <Kbd>{key}</Kbd>
                </button>
              }
            />
          ))}
          <SettingRow
            htmlFor="hints"
            title="Буквы клавиш на кнопках"
            description="Маленькая подсказка в углу кнопок дока"
            control={<Switch id="hints" checked={hints} onCheckedChange={setHints} />}
          />
        </div>
        <Button variant="ghost" size="sm" icon="reset" className="self-start">
          Сбросить клавиши
        </Button>
      </Section>
    </div>
  );
}

function SoundsTab() {
  const [on, setOn] = useState(true);
  const [vol, setVol] = useState(60);
  return (
    <div className="flex flex-col gap-6">
      <Section title="Звуки интерфейса">
        <div className="divide-y divide-line rounded-card border border-line px-4">
          <SettingRow
            htmlFor="sfx"
            title="Звуки событий"
            description="Вход и выход друзей, сообщения, микрофон"
            control={<Switch id="sfx" checked={on} onCheckedChange={setOn} />}
          />
          <div className="py-3">
            <Slider label="Громкость звуков" value={vol} onValueChange={setVol} disabled={!on} formatValue={(v) => `${v}%`} />
          </div>
        </div>
        <Button variant="secondary" size="sm" icon="bell" className="self-start" disabled={!on}>
          Проверить звук
        </Button>
      </Section>
      <BoardSection />
    </div>
  );
}

/** Соундборд — как BoardSounds комнаты (виден при флаге soundboard). */
function BoardSection() {
  const [on, setOn] = useState(true);
  const [vol, setVol] = useState(50);
  const [enter, setEnter] = useState("tada");
  return (
    <Section title="Соундборд">
      <div className="divide-y divide-line rounded-card border border-line px-4">
        <SettingRow
          htmlFor="board"
          title="Звуки других"
          description="Ба-дум-тсс, та-дам и другие звуки, которые включают люди в комнате"
          control={<Switch id="board" checked={on} onCheckedChange={setOn} />}
        />
        <div className="py-3">
          <Slider label="Громкость звуков других" value={vol} onValueChange={setVol} disabled={!on} formatValue={(v) => `${v}%`} />
        </div>
      </div>
      <Select
        label="Мой звук входа"
        icon="volume"
        value={enter}
        options={[
          { value: "", label: "Обычный" },
          { value: "tada", label: "Та-дам" },
          { value: "vine", label: "Вайн бум" },
          { value: "bonk", label: "Бонк" },
        ]}
        hint="Его услышат все, когда вы войдёте в комнату. Новый звук — со следующего входа"
        onChange={(e) => setEnter(e.target.value)}
      />
    </Section>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
  initialTab = "voice",
  live = true,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialTab?: SettingsTab;
  live?: boolean;
}) {
  const [tab, setTab] = useState<string>(initialTab);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Настройки"
      size="xl"
      padded={false}
      data-testid="settings-dialog"
      bodyClassName="flex max-sm:flex-col"
      className="sm:h-[min(88dvh,720px)]"
    >
      <Tabs value={tab} onValueChange={setTab} orientation="vertical" className="contents">
        <TabList
          label="Разделы настроек"
          className="w-52 shrink-0 border-r border-line p-3 max-sm:w-auto max-sm:flex-row max-sm:gap-1 max-sm:overflow-x-auto max-sm:border-b max-sm:border-r-0 max-sm:px-4 max-sm:py-2 max-sm:[scrollbar-width:none]"
        >
          <Tab value="voice" icon="mic" className="max-sm:w-auto">
            Голос
          </Tab>
          <Tab value="screen" icon="monitor" className="max-sm:w-auto">
            Экран
          </Tab>
          <Tab value="keys" icon="keyboard" className="max-sm:w-auto">
            Клавиши
          </Tab>
          <Tab value="sounds" icon="bell" className="max-sm:w-auto">
            Звуки
          </Tab>
        </TabList>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-4 max-sm:px-5">
          <TabPanel value="voice">
            <VoiceTab live={live} />
          </TabPanel>
          <TabPanel value="screen">
            <ScreenTab />
          </TabPanel>
          <TabPanel value="keys">
            <KeysTab />
          </TabPanel>
          <TabPanel value="sounds">
            <SoundsTab />
          </TabPanel>
        </div>
      </Tabs>
    </Dialog>
  );
}

/**
 * Настройки комнаты — только для хоста. Всё применяется сразу (кнопки
 * «Сохранить» нет), пароль — полем и кнопками «Задать» / «Снять пароль»,
 * «Готово» закрывает окно.
 */
export function RoomSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [locked, setLocked] = useState(false);
  const [listed, setListed] = useState(true);
  const [chat, setChat] = useState<"all" | "host" | "off">("all");
  const [share, setShare] = useState<"all" | "approved" | "host">("all");
  const [password, setPassword] = useState("");
  const [banned, setBanned] = useState(["Гоша_2009", "Night Owl"]);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Настройки комнаты"
      description="Изменения применяются сразу. Это окно есть только у хоста."
      size="md"
      footer={
        <Button variant="primary" onClick={() => onOpenChange(false)}>
          Готово
        </Button>
      }
    >
      <div className="flex flex-col gap-7">
        <Section title="Вход">
          <div className="divide-y divide-line rounded-card border border-line px-4">
            <SettingRow
              htmlFor="lock"
              title="Закрыть вход"
              description="Новые люди не смогут зайти, даже по ссылке"
              control={<Switch id="lock" checked={locked} onCheckedChange={setLocked} />}
            />
            <SettingRow
              htmlFor="listed"
              title="Показывать в списке комнат"
              description="Её найдут на странице «Открытые комнаты»"
              control={<Switch id="listed" checked={listed} onCheckedChange={setListed} />}
            />
            <div className="flex flex-col gap-2 py-3">
              <TextField
                label="Пароль"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••"
                hint="Пароль задан. Чтобы сменить, введите новый и нажмите «Задать»."
              />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" icon="key" disabled={password.trim().length < 4}>
                  Задать
                </Button>
                <Button size="sm" variant="ghost" icon="trash">
                  Снять пароль
                </Button>
              </div>
            </div>
          </div>
        </Section>
        <Section title="Кто что может">
          <div className="divide-y divide-line rounded-card border border-line px-4">
            <div className="flex flex-col gap-2 py-3">
              <span className="text-body text-ink">Показывать экран</span>
              <SegmentedControl
                label="Кто может показывать экран"
                size="sm"
                block
                value={share}
                onValueChange={setShare}
                options={[
                  { value: "all", label: "Все" },
                  { value: "approved", label: "По разрешению" },
                  { value: "host", label: "Только хост" },
                ]}
              />
            </div>
            <div className="flex flex-col gap-2 py-3">
              <span className="text-body text-ink">Чат</span>
              <SegmentedControl
                label="Кто может писать в чат"
                size="sm"
                block
                value={chat}
                onValueChange={setChat}
                options={[
                  { value: "all", label: "Все" },
                  { value: "host", label: "Только хост" },
                  { value: "off", label: "Выключен" },
                ]}
              />
            </div>
          </div>
        </Section>
        <Section title="Забанены">
          {banned.length === 0 ? (
            <p className="text-body text-ink-3">Никого. Забанить можно в меню участника.</p>
          ) : (
            <ul className="divide-y divide-line rounded-card border border-line">
              {banned.map((n) => (
                <li key={n} className="flex items-center gap-3 py-2 pl-4 pr-2">
                  <span className="min-w-0 flex-1 truncate text-body text-ink">{n}</span>
                  <Button size="sm" variant="ghost" onClick={() => setBanned((b) => b.filter((x) => x !== n))}>
                    Разбанить
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </Dialog>
  );
}

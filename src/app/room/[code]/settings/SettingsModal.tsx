"use client";

import { useState, useSyncExternalStore } from "react";
import { Dialog, Tab, TabList, TabPanel, Tabs, type IconName } from "@/components/ui";
import KeysTab from "./KeysTab";
import ScreenTab from "./ScreenTab";
import SoundsTab from "./SoundsTab";
import { useSettingsDialog, type SettingsTab } from "./useSettingsDialog";
import VoiceTab from "./VoiceTab";

const TABS: { value: SettingsTab; label: string; icon: IconName }[] = [
  { value: "voice", label: "Голос", icon: "mic" },
  { value: "screen", label: "Экран", icon: "monitor" },
  { value: "keys", label: "Клавиши", icon: "keyboard" },
  { value: "sounds", label: "Звуки", icon: "bell" },
];

// Узкий экран — как max-sm в Tailwind: вкладки идут строкой сверху.
const NARROW = "(width < 40rem)";
const subscribeNarrow = (onChange: () => void) => {
  const mq = window.matchMedia(NARROW);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};
const isNarrow = () => window.matchMedia(NARROW).matches;

/**
 * Окно настроек (макет /design/settings): слева вкладки, справа прокрутка; на
 * узком экране — лист снизу и вкладки строкой. Сам диалог живёт всегда (так
 * нативный <dialog> возвращает фокус на кнопку, которая его открыла), а
 * содержимое — только пока окно открыто: проверка микрофона и метры
 * останавливаются при закрытии, вкладка сбрасывается.
 */
export default function SettingsModal() {
  const { open, tab, close } = useSettingsDialog();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title="Настройки"
      size="xl"
      padded={false}
      data-testid={open ? "settings-dialog" : undefined}
      bodyClassName="flex max-sm:flex-col"
      // Высота окна постоянная: вкладки не прыгают. Прокручивается правая колонка.
      className="sm:h-[min(88dvh,720px)]"
    >
      {open && <SettingsBody initialTab={tab} />}
    </Dialog>
  );
}

function SettingsBody({ initialTab }: { initialTab: SettingsTab }) {
  const [tab, setTab] = useState<string>(initialTab);
  // В строку на 360 px четыре вкладки с иконками не влезают — «Звуки»
  // уезжала за край. На узком — только подписи, вкладки делят ширину поровну.
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow, () => false);
  return (
    <Tabs value={tab} onValueChange={setTab} orientation="vertical" className="contents">
      <TabList
        label="Разделы настроек"
        className="w-52 shrink-0 border-r border-line p-3 max-sm:w-auto max-sm:flex-row max-sm:gap-1 max-sm:overflow-x-auto max-sm:border-b max-sm:border-r-0 max-sm:px-4 max-sm:py-2 max-sm:[scrollbar-width:none]"
      >
        {TABS.map((t) => (
          <Tab
            key={t.value}
            value={t.value}
            icon={narrow ? undefined : t.icon}
            className="max-sm:w-auto max-sm:grow max-sm:justify-center"
          >
            {t.label}
          </Tab>
        ))}
      </TabList>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-4 max-sm:px-5">
        <TabPanel value="voice">
          <VoiceTab />
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
  );
}

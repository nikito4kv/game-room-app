"use client";

import { useState, useSyncExternalStore } from "react";
import { IconButton, Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui";
import { outputSelectionSupported } from "@/lib/audio/playback";
import { useDeviceChoice } from "../audio/useAudioDevices";
import { useRoomActions } from "../state/RoomActions";

type Kind = "audioinput" | "audiooutput";

const TEXT: Record<Kind, { menu: string; trigger: string; title: string }> = {
  audioinput: { menu: "Выбор микрофона", trigger: "Выбрать микрофон", title: "Микрофон" },
  audiooutput: { menu: "Выбор вывода звука", trigger: "Выбрать наушники или колонки", title: "Вывод звука" },
};

const noSubscribe = () => () => {};

/**
 * Шеврон рядом с кнопкой микрофона или звука — быстрый выбор устройства, не
 * открывая настройки. Список устройств читается, только пока меню открыто;
 * выбор и его сохранение — те же, что во вкладке настроек (useDeviceChoice):
 * не открылось устройство — остаётся прежнее, а тост скажет почему. Где
 * браузер не умеет выбирать вывод звука (Firefox, Safari), шеврона у звука нет.
 * На узком окне шевроны скрыты.
 */
export default function DeviceMenu({ kind }: { kind: Kind }) {
  const [open, setOpen] = useState(false);
  const { openSettings } = useRoomActions();
  const canChoose = useSyncExternalStore(
    noSubscribe,
    () => kind === "audioinput" || outputSelectionSupported(),
    () => false,
  );
  if (!canChoose) return null;
  const t = TEXT[kind];
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      label={t.menu}
      side="top"
      align="start"
      className="w-72"
      trigger={
        <IconButton
          icon="chevron-up"
          label={t.trigger}
          size="split"
          variant="quiet"
          className="max-sm:hidden"
          tooltip={false}
        />
      }
    >
      <MenuLabel>{t.title}</MenuLabel>
      {open && <DeviceItems kind={kind} />}
      <MenuSeparator />
      <MenuItem icon="settings" onSelect={() => openSettings()}>
        Настройки звука
      </MenuItem>
    </Menu>
  );
}

function DeviceItems({ kind }: { kind: Kind }) {
  const choice = useDeviceChoice(kind);
  if (choice.options.length === 0) return <MenuItem disabled>Устройства не найдены</MenuItem>;
  return (
    <>
      {choice.options.map((o) => (
        <MenuItem key={o.value} checked={o.value === choice.selected} onSelect={() => choice.pick(o.value)}>
          {o.label}
        </MenuItem>
      ))}
    </>
  );
}

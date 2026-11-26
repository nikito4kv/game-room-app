"use client";

import { useEffect, useState } from "react";
import { useRoomMeta } from "../state/useRoomMeta";
import RoomSettingsDialog from "./RoomSettingsDialog";
import { closeRoomSettings, useRoomSettingsOpen } from "./roomSettingsStore";

/**
 * Диалоги хоста. Ставится один раз внутри корня комнаты (UiRoot): сами окна
 * живут в top layer, место в DOM не важно, но стили берутся от data-ui предка.
 */
export default function HostDialogs() {
  const wanted = useRoomSettingsOpen();
  const { meta, amHost } = useRoomMeta();
  const open = wanted && amHost && !!meta;

  // Права ушли, пока окно открыто, — закрываем; ушли из комнаты — тоже.
  useEffect(() => {
    if (wanted && !amHost) closeRoomSettings();
  }, [wanted, amHost]);
  useEffect(() => closeRoomSettings, []);

  // Каждое открытие — свежая форма по текущему описанию комнаты.
  const [opened, setOpened] = useState(0);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setOpened((n) => n + 1);
  }

  if (!meta) return null;
  return (
    <RoomSettingsDialog
      key={opened}
      meta={meta}
      open={open}
      onOpenChange={(next) => {
        if (!next) closeRoomSettings();
      }}
    />
  );
}

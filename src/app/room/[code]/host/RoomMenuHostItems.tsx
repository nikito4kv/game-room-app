"use client";

import { MenuItem, MenuLabel, MenuSeparator } from "@/components/ui";
import { useHostActions } from "./useHostActions";

/**
 * Пункты хоста для меню названия комнаты в шапке (вставляются внутрь её <Menu>
 * перед «Выйти»). Хосту — настройки и замок, владельцу без прав — «Вернуть
 * права хоста», остальным — ничего.
 */
export default function RoomMenuHostItems() {
  const { amHost, canReclaim, locked, toggleLock, reclaim, openRoomSettings } = useHostActions();

  if (amHost) {
    return (
      <>
        <MenuSeparator />
        <MenuLabel>Вы хост</MenuLabel>
        <MenuItem data-testid="menu-room-settings" icon="shield" onSelect={openRoomSettings}>
          Настройки комнаты
        </MenuItem>
        <MenuItem
          data-testid="menu-lock"
          icon={locked ? "lock" : "unlock"}
          checked={locked}
          keepOpen
          onSelect={toggleLock}
        >
          Закрыть вход
        </MenuItem>
      </>
    );
  }

  if (canReclaim) {
    return (
      <>
        <MenuSeparator />
        <MenuItem data-testid="menu-reclaim" icon="crown" onSelect={reclaim}>
          Вернуть права хоста
        </MenuItem>
      </>
    );
  }

  return null;
}

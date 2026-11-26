"use client";

import { createContext, use, useCallback, useMemo, useState, type ReactNode } from "react";

/** Вкладки окна настроек (как в макете /design/settings). */
export type SettingsTab = "voice" | "screen" | "keys" | "sounds";

export type SettingsDialog = {
  open: boolean;
  /** С какой вкладки открыли окно. */
  tab: SettingsTab;
  /** Открыть на вкладке (по умолчанию — «Голос»). */
  openSettings: (tab?: SettingsTab) => void;
  close: () => void;
};

const SettingsDialogContext = createContext<SettingsDialog | null>(null);

/** Открыто ли окно настроек. Открывают док (шестерёнка) и useRoomActions().openSettings. */
export function SettingsDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; tab: SettingsTab }>({
    open: false,
    tab: "voice",
  });
  const openSettings = useCallback((tab: SettingsTab = "voice") => setState({ open: true, tab }), []);
  const close = useCallback(() => setState((s) => ({ ...s, open: false })), []);
  const value = useMemo<SettingsDialog>(
    () => ({ open: state.open, tab: state.tab, openSettings, close }),
    [state, openSettings, close],
  );
  return <SettingsDialogContext value={value}>{children}</SettingsDialogContext>;
}

export function useSettingsDialog(): SettingsDialog {
  const value = use(SettingsDialogContext);
  if (!value) throw new Error("useSettingsDialog: нет SettingsDialogProvider выше по дереву");
  return value;
}

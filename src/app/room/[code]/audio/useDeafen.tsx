"use client";

import { createContext, use, useCallback, useMemo, useState, type ReactNode } from "react";
import { playSfx } from "@/lib/audio/sfx";

export type Deafen = {
  /**
   * «Звук выкл», как в Discord: чужой звук не слышен (RoomAudio) и свой микрофон
   * заглушён (MicProvider). Снятие возвращает микрофон в прежнее состояние.
   */
  deafened: boolean;
  /** Переключить со звуком — то же, что useRoomActions().toggleDeafen. */
  toggle: () => void;
  /** Установить без звука — для «включил микрофон при „Звук выкл“ → звук тоже вернулся». */
  set: (deafened: boolean) => void;
};

const DeafenContext = createContext<Deafen | null>(null);

export function DeafenProvider({ children }: { children: ReactNode }) {
  const [deafened, setDeafened] = useState(false);
  const toggle = useCallback(() => {
    // При ВЫКЛЮЧЕНИИ заглушки модульный флаг deafened в sfx ещё true (его синхронит
    // эффект setSfxDeafened в useRoomSounds только после ре-рендера), поэтому без
    // urgent звук deafen-off отсёкся бы гейтом «не играть при deafen». Помечаем
    // выключение urgent — оно должно прозвучать.
    playSfx(deafened ? "deafen-off" : "deafen-on", deafened ? { urgent: true } : undefined);
    setDeafened((v) => !v);
  }, [deafened]);
  const value = useMemo(() => ({ deafened, toggle, set: setDeafened }), [deafened, toggle]);
  return <DeafenContext value={value}>{children}</DeafenContext>;
}

export function useDeafen(): Deafen {
  const value = use(DeafenContext);
  if (!value) throw new Error("useDeafen: нет DeafenProvider выше по дереву");
  return value;
}

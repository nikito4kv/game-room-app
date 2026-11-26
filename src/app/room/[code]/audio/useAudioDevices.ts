"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useRoomContext } from "@livekit/components-react";
import type { Room } from "livekit-client";
import { toast } from "@/components/ui";
import { deviceOptions, type DeviceInfo } from "@/lib/audio/devices";
import { isMicError } from "@/lib/audio/micErrors";
import { outputSelectionSupported, switchOutput } from "@/lib/audio/playback";
import { usePersistentState } from "../state/usePersistentState";
import { useVoiceControls } from "./useMic";
import { outputDevicePref } from "./voicePrefs";

// Список устройств звука — общий на вкладку: перечитываем при подключении и
// отключении устройств (devicechange) и только пока кто-то смотрит.
let devices: DeviceInfo[] = [];
const EMPTY: DeviceInfo[] = [];
const listeners = new Set<() => void>();

async function refresh(): Promise<void> {
  const list = await navigator.mediaDevices.enumerateDevices().catch(() => null);
  if (!list) return;
  devices = list;
  listeners.forEach((l) => l());
}

function subscribe(onChange: () => void): () => void {
  const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  if (!media) return () => {};
  listeners.add(onChange);
  if (listeners.size === 1) {
    media.addEventListener("devicechange", refresh);
    void refresh();
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) media.removeEventListener("devicechange", refresh);
  };
}

export type AudioDeviceOption = { value: string; label: string };

/**
 * Микрофоны и устройства вывода для выпадающих списков: первым — «Как в
 * системе (имя)», дальше настоящие устройства без служебных записей Chrome.
 */
export function useAudioDevices(): { inputs: AudioDeviceOption[]; outputs: AudioDeviceOption[] } {
  const list = useSyncExternalStore(subscribe, () => devices, () => EMPTY);
  return useMemo(
    () => ({
      inputs: deviceOptions(list, "audioinput", "Микрофон"),
      outputs: deviceOptions(list, "audiooutput", "Устройство вывода"),
    }),
    [list],
  );
}

/**
 * Сменить вывод: сначала переключаем (не вышло — бросает, выбор не меняется),
 * потом сохраняем. В Firefox и Safari выбора нет — смотрите outputSelectionSupported.
 */
export async function chooseOutput(deviceId: string, room: Room): Promise<void> {
  await switchOutput(deviceId, room);
  outputDevicePref.set(deviceId);
}

export type DeviceChoice = {
  options: AudioDeviceOption[];
  /** Что выбрано: «default» (как в системе) или deviceId. */
  selected: string;
  /** Браузер умеет выбирать это устройство (вывод — только Chrome/Edge). */
  supported: boolean;
  /** Выбрать и дождаться. Не вышло — прежнее остаётся, бросает ошибку (у микрофона — MicError с текстом). */
  select: (deviceId: string) => Promise<void>;
  /** То же, но ошибку показывает тостом — для меню, где ждать некому. */
  pick: (deviceId: string) => void;
};

/** Выбор микрофона или вывода — для меню в доке и окна настроек. */
export function useDeviceChoice(kind: "audioinput" | "audiooutput"): DeviceChoice {
  const room = useRoomContext();
  const { inputs, outputs } = useAudioDevices();
  const { inputChoice, setInputDevice } = useVoiceControls();
  const [output] = usePersistentState(outputDevicePref);
  const isInput = kind === "audioinput";
  const select = useCallback(
    (id: string) => (isInput ? setInputDevice(id) : chooseOutput(id, room)),
    [isInput, setInputDevice, room],
  );
  const pick = useCallback(
    (id: string) => {
      select(id).catch((e: unknown) => {
        const mic = isMicError(e) ? e : null;
        toast({
          id: `${kind}-pick`,
          tone: "alert",
          icon: isInput ? "mic" : "headphones",
          title: mic?.title ?? "Не получилось переключить звук",
          description: mic ? "Оставили прежний микрофон." : "Устройство недоступно — звук остался на прежнем.",
        });
      });
    },
    [select, isInput, kind],
  );
  return {
    options: isInput ? inputs : outputs,
    selected: isInput ? inputChoice : output,
    supported: isInput || outputSelectionSupported(),
    select,
    pick,
  };
}

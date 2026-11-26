// Настройки «для себя», которые читают сразу несколько областей комнаты: док,
// горячие клавиши, рация, демонстрация и окно настроек. Ключи хранилища и защита
// от мусора — в @/lib/clientStorage, здесь только общий доступ (usePersistentState).
// Настройку одной области заводите рядом с её кодом (persistentKey + readLocal…),
// а не в этом файле.
import {
  DEFAULT_KEYBINDS,
  getKeybinds,
  getShowKeys,
  getVoiceMode,
  readLocal,
  setKeybinds,
  setShowKeys,
  setVoiceMode,
  writeLocal,
  type Keybinds,
  type VoiceMode,
} from "@/lib/clientStorage";
import { DEFAULT_SCREEN_QUALITY, isScreenQuality, type ScreenQuality } from "@/lib/screenShare";
import { persistentKey } from "./usePersistentState";

// Ключ здесь, а не в clientStorage: тот берёт лендинг, и screenShare приехал бы
// в его бандл.
const SCREEN_QUALITY_KEY = "gr.screen.quality";
const SCREEN_DUCK_KEY = "gr.screen.duck";

/** Привязки горячих клавиш: действие → KeyboardEvent.code. */
export const bindsPref = persistentKey<Keybinds>({
  read: getKeybinds,
  write: setKeybinds,
  initial: DEFAULT_KEYBINDS,
});

/** Режим голоса: открытый микрофон или рация. */
export const voiceModePref = persistentKey<VoiceMode>({
  read: getVoiceMode,
  write: setVoiceMode,
  initial: "toggle",
});

/** Показывать букву бинда в углу кнопок дока. */
export const showKeysPref = persistentKey<boolean>({
  read: getShowKeys,
  write: setShowKeys,
  initial: true,
});

/** Профиль качества демонстрации экрана. Мусор в хранилище — профиль по умолчанию. */
export const screenQualityPref = persistentKey<ScreenQuality>({
  read: () => {
    const raw = readLocal(SCREEN_QUALITY_KEY);
    return isScreenQuality(raw) ? raw : DEFAULT_SCREEN_QUALITY;
  },
  write: (q) => writeLocal(SCREEN_QUALITY_KEY, q),
  initial: DEFAULT_SCREEN_QUALITY,
});

/** Приглушать звук чужого показа, пока говорят (флаг screen_ducking). По умолчанию — да. */
export const screenDuckPref = persistentKey<boolean>({
  read: () => readLocal(SCREEN_DUCK_KEY) !== "0",
  write: (on) => writeLocal(SCREEN_DUCK_KEY, on ? "1" : "0"),
  initial: true,
});

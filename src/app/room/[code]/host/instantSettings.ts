// «Настройки комнаты» применяются сразу (решение М8): каждый переключатель и
// выбор уходит на сервер в момент нажатия. Здесь — чистая логика оптимистичного
// показа: что рисовать, пока сервер не ответил, и как откатить при ошибке.
//
// Новое описание комнаты приходит отдельно от ответа сервера (RoomMetadataChanged),
// иногда чуть позже. Поэтому выбранное значение держим, пока его запрос не
// закончился, а после успеха — пока описание комнаты его не догонит. Иначе
// переключатель на мгновение прыгал бы назад.
import type { ChatPolicy, RoomPublicMeta, RoomSettingsPatch, ScreenPolicy } from "@/lib/api/contract";

/** Поля, которые меняются одним нажатием. Пароль — отдельно, кнопками. */
export type InstantSettings = {
  locked: boolean;
  isPublic: boolean;
  screen: ScreenPolicy;
  chat: ChatPolicy;
};

export type InstantField = keyof InstantSettings;

/** Выбор, ещё не подтверждённый описанием комнаты. seq — номер нажатия: ответ на старое нажатие новое не трогает. */
type Change<K extends InstantField> = { value: InstantSettings[K]; seq: number; done: boolean };

export type SettingsDraft = { [K in InstantField]?: Change<K> };

/** Текущие значения из описания комнаты. */
export function settingsFromMeta(meta: RoomPublicMeta): InstantSettings {
  return {
    locked: meta.locked,
    isPublic: meta.isPublic,
    screen: meta.settings.screen,
    chat: meta.settings.chat,
  };
}

/** Запрос серверу на одно поле: отправляем только нажатое. */
export function patchOf<K extends InstantField>(field: K, value: InstantSettings[K]): RoomSettingsPatch {
  const patch: Partial<InstantSettings> = {};
  patch[field] = value;
  return patch;
}

/**
 * Что показывать: выбранное, пока его запрос идёт или описание комнаты ещё не
 * догнало ответ; иначе — описание комнаты.
 */
export function shownSettings(current: InstantSettings, draft: SettingsDraft): InstantSettings {
  const pick = <K extends InstantField>(field: K): InstantSettings[K] => {
    const change = draft[field] as Change<K> | undefined;
    if (!change || (change.done && current[field] === change.value)) return current[field];
    return change.value;
  };
  return { locked: pick("locked"), isPublic: pick("isPublic"), screen: pick("screen"), chat: pick("chat") };
}

/** Нажали: показываем выбранное сразу. */
export function startChange<K extends InstantField>(
  draft: SettingsDraft,
  field: K,
  value: InstantSettings[K],
  seq: number,
): SettingsDraft {
  return { ...draft, [field]: { value, seq, done: false } };
}

/**
 * Сервер ответил. Успех — ждём, пока описание комнаты догонит; ошибка —
 * откат к описанию комнаты. Ответ на устаревшее нажатие (было новее) ничего не меняет.
 */
export function finishChange(draft: SettingsDraft, field: InstantField, seq: number, ok: boolean): SettingsDraft {
  const change = draft[field];
  if (!change || change.seq !== seq) return draft;
  if (ok) return { ...draft, [field]: { ...change, done: true } };
  const next = { ...draft };
  delete next[field];
  return next;
}

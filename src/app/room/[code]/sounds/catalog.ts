"use client";

import { useSyncExternalStore } from "react";
import { BUILTIN_SOUND_IDS, isCustomSoundId, isSoundId, type RoomSound, type SoundId } from "@/lib/api/contract";
import { preloadBoardSound, setSoundResolver } from "@/lib/audio/soundboard";
import { getRoomSounds } from "@/lib/client/api";
import { BUILTIN_SOUND_NAMES } from "./view";

// Каталог звуков комнаты на клиенте: готовый набор (файлы public/sounds, список —
// pack.json), свои звуки комнаты (с сервера) и вшитые синтезированные — запасной
// набор, пока готового нет. Одно хранилище на вкладку: панель, настройки и
// приём чужих звуков берут имя и адрес файла отсюда.

/** Звук в каталоге: откуда он и можно ли его убрать. */
export type CatalogSound = { id: SoundId; name: string; source: "pack" | "builtin" | "room"; by?: string };

type PackEntry = { id: string; name: string; file: string };

type State = { pack: PackEntry[] | null; room: RoomSound[]; code: string | null };
let state: State = { pack: null, room: [], code: null };
let snapshot: readonly CatalogSound[] = [];
const listeners = new Set<() => void>();

function rebuild(): void {
  const base: CatalogSound[] = state.pack?.length
    ? state.pack.map((p) => ({ id: p.id, name: p.name, source: "pack" as const }))
    : BUILTIN_SOUND_IDS.map((id) => ({ id, name: BUILTIN_SOUND_NAMES[id], source: "builtin" as const }));
  const room = state.room.map((s) => ({ id: s.id, name: s.name, source: "room" as const, by: s.by }));
  snapshot = [...base, ...room];
  listeners.forEach((l) => l());
}
rebuild();

setSoundResolver((id) => {
  const hit = state.pack?.find((p) => p.id === id);
  if (hit) return `/sounds/${encodeURIComponent(hit.file)}`;
  if (isCustomSoundId(id) && state.code) return `/api/sounds/${id}?code=${encodeURIComponent(state.code)}`;
  return null;
});

/** Название по имени звука (для ленты и скринридера); неизвестный — «звук». */
export function soundName(id: SoundId): string {
  return snapshot.find((s) => s.id === id)?.name ?? "звук";
}

/** Какая комната сейчас; другая комната — свой список звуков. */
export function setCatalogRoom(code: string | null): void {
  if (state.code === code) return;
  state = { ...state, code, room: [] };
  rebuild();
}

/** Готовый набор из public/sounds/pack.json; файла нет или он пуст — остаются вшитые. */
export async function loadPack(): Promise<void> {
  if (state.pack !== null) return;
  try {
    const res = await fetch("/sounds/pack.json", { cache: "no-cache" });
    const data: unknown = res.ok ? await res.json() : null;
    const raw = typeof data === "object" && data !== null ? (data as { sounds?: unknown }).sounds : null;
    const pack = Array.isArray(raw)
      ? raw.flatMap((e): PackEntry[] =>
          typeof e === "object" &&
          e !== null &&
          isSoundId((e as PackEntry).id) &&
          typeof (e as PackEntry).name === "string" &&
          typeof (e as PackEntry).file === "string"
            ? [{ id: (e as PackEntry).id, name: (e as PackEntry).name.slice(0, 24), file: (e as PackEntry).file }]
            : [],
        )
      : [];
    state = { ...state, pack };
  } catch {
    state = { ...state, pack: [] };
  }
  rebuild();
  for (const s of snapshot) if (s.source === "pack") preloadBoardSound(s.id);
}

/** Звуки комнаты с сервера (нужен токен участника). */
export async function refreshRoomSounds(code: string, token: string): Promise<void> {
  const res = await getRoomSounds(code, token);
  if (state.code !== code) return;
  state = { ...state, room: res.sounds };
  rebuild();
  for (const s of res.sounds) preloadBoardSound(s.id);
}

/** Звуки для панели: набор (или вшитые) и звуки комнаты. */
export function useSoundCatalog(): readonly CatalogSound[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => snapshot,
    () => snapshot,
  );
}

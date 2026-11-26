"use client";

import { useEffect } from "react";
import { useConnectionState, useRoomContext } from "@livekit/components-react";
import { ConnectionState, RoomEvent, type RemoteParticipant } from "livekit-client";
import { SOUNDS_CHANGED_TOPIC } from "@/lib/api/contract";
import { useRoomSession } from "../state/RoomSession";
import { useRoomConfig } from "../state/useRoomConfig";
import { loadPack, refreshRoomSounds, setCatalogRoom } from "./catalog";

/**
 * Держит каталог звуков комнаты актуальным (catalog.ts): готовый набор — один
 * раз, звуки комнаты — при входе и каждый раз, когда сервер сообщил, что список
 * поменялся (пакет SOUNDS_CHANGED_TOPIC, только от сервера). Ничего не рисует.
 * Флаги выключены — не делает ни одного запроса.
 */
export function useCatalogSync(): void {
  const room = useRoomContext();
  const { code, token } = useRoomSession();
  const { flags } = useRoomConfig();
  const connected = useConnectionState(room) === ConnectionState.Connected;
  const board = flags.soundboard;
  const upload = flags.soundboard_upload;

  useEffect(() => {
    setCatalogRoom(code);
    return () => setCatalogRoom(null);
  }, [code]);

  useEffect(() => {
    if (board) void loadPack();
  }, [board]);

  useEffect(() => {
    if (!board || !upload || !connected) return;
    const refresh = () => void refreshRoomSounds(code, token).catch(() => undefined);
    refresh();
    const onData = (_payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic === SOUNDS_CHANGED_TOPIC && participant == null) refresh();
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room, code, token, board, upload, connected]);
}

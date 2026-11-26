"use client";

import { useEffect, useRef } from "react";
import { useConnectionState } from "@livekit/components-react";
import { ConnectionState } from "livekit-client";
import { getHostKey, takeEntry } from "@/lib/clientStorage";
import { EVENTS, track } from "@/lib/analytics/posthogClient";
import { initSfx, playSfx, setSfxDeafened } from "@/lib/audio/sfx";
import { initBoard, setBoardDeafened } from "@/lib/audio/soundboard";
import { useDeafen } from "../audio/useDeafen";
import { useMic } from "../audio/useMic";
import { useRoomMeta } from "./useRoomMeta";
import { useRoomSession } from "./RoomSession";

/**
 * Звуки интерфейса по переходам состояний комнаты: вход, связь, права, замок,
 * мьют от хоста. Свои действия (микрофон, экран, чат…) озвучиваются в местах
 * вызова, ошибки модерации — в useModeration. graceOver — см. useHostGrace: до
 * него звуки прав и замка молчат, пока metadata устаканивается (создатель входит молча).
 */
export function useRoomSounds(graceOver: boolean): void {
  const state = useConnectionState();
  const { code, rejoining } = useRoomSession();
  const { meta, amHost, locked } = useRoomMeta();
  const { deafened } = useDeafen();
  const { forceMuted: forceMutedMe, error: micError } = useMic();
  const micDenied = micError !== null;

  // Предзагрузка буферов и синхронизация настроек — один раз при входе.
  useEffect(() => {
    initSfx();
    initBoard();
  }, []);
  // «Заглушить всё» гасит бытовые звуки (но не тревоги) и соундборд — сообщаем модулям.
  useEffect(() => {
    setSfxDeafened(deafened);
    setBoardDeafened(deafened);
  }, [deafened]);
  // Вошёл в комнату — один раз при первом успешном подключении.
  const enteredRef = useRef(false);
  useEffect(() => {
    if (state === ConnectionState.Connected && !enteredRef.current) {
      enteredRef.current = true;
      playSfx("enter");
      // Аналитика. Источник входа: маркер лендинга; если его нет (новая вкладка,
      // перезагрузка, повторный заход) — по наличию ключа владельца понимаем, что
      // это создатель; иначе считаем входом по ссылке. has_password со стороны
      // входящего достоверно неизвестен (хранится приватно на сервере) — не шлём.
      const entry = takeEntry(code) ?? (getHostKey(code) ? "created" : "link");
      track(EVENTS.roomJoined, { entry, is_public: meta?.isPublic ?? false });
    }
  }, [state, code, meta]);
  // Потеря / восстановление связи (тревога — звучит даже при «заглушить всё»).
  // Связь «лежит», пока LiveKit переподключается сам или мы входим заново.
  const down = rejoining || state === ConnectionState.Reconnecting;
  const prevDownRef = useRef(false);
  useEffect(() => {
    const prev = prevDownRef.current;
    if (down && !prev) playSfx("reconnecting", { urgent: true });
    else if (!down && prev && state === ConnectionState.Connected) playSfx("reconnected", { urgent: true });
    prevDownRef.current = down;
  }, [down, state]);
  // Хост заглушил мой микрофон.
  const prevForceMutedRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (prevForceMutedRef.current === false && forceMutedMe) {
      playSfx("force-muted", { urgent: true });
    }
    prevForceMutedRef.current = forceMutedMe;
  }, [forceMutedMe]);
  // Нет доступа к микрофону.
  const prevMicDeniedRef = useRef(false);
  useEffect(() => {
    if (!prevMicDeniedRef.current && micDenied) playSfx("mic-denied", { urgent: true });
    prevMicDeniedRef.current = micDenied;
  }, [micDenied]);
  // Мне передали права хоста. Только после grace-периода — иначе звук сыграл бы
  // на старте, пока metadata устаканивается (создатель — молча).
  const prevAmHostRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (prevAmHostRef.current === false && amHost && graceOver) playSfx("host-granted");
    prevAmHostRef.current = amHost;
  }, [amHost, graceOver]);
  // Комнату заперли / открыли (слышат все участники).
  const prevLockedRef = useRef<boolean | null>(null);
  useEffect(() => {
    const prev = prevLockedRef.current;
    if (prev !== null && prev !== locked && graceOver) playSfx(locked ? "lock" : "unlock");
    prevLockedRef.current = locked;
  }, [locked, graceOver]);
}

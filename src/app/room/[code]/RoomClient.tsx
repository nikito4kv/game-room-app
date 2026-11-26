"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LiveKitRoom, useConnectionState } from "@livekit/components-react";
import {
  ConnectionError,
  ConnectionState,
  DefaultReconnectPolicy,
  Room,
  RoomEvent,
  Track,
  type DisconnectReason,
  type LocalTrackPublication,
  type Participant,
  type TrackPublication,
} from "livekit-client";
import {
  parseParticipantPublicMeta,
  parseRoomPublicMeta,
  type PreviewResponse,
  type TokenResponse,
} from "@/lib/api/contract";
import { knownDevices } from "@/lib/audio/deviceList";
import { resumePlayback } from "@/lib/audio/playback";
import { playSfx } from "@/lib/audio/sfx";
import { getInputDevice } from "@/lib/clientStorage";
import { rememberRoom } from "@/lib/client/recentRooms";
import { endScreenView } from "@/lib/client/joinScreens";
import {
  ROOM_RECONNECT_DELAYS_MS,
  classifyDisconnect,
  isRejoining,
  shouldConnect,
} from "@/lib/client/session";
import { withSentry } from "@/lib/observability/sentryClient";
import { clearRoomContext, setRoomContext } from "@/lib/observability/sentryRoom";
import { buildRoomOptions } from "@/lib/roomOptions";
import { FALLBACK_PUBLIC_CONFIG } from "@/lib/client/publicConfig";
import { usePublicConfig } from "@/lib/client/usePublicConfig";
import { recapWorthShowing, type Recap } from "@/lib/room/recap";
import RoomAudio from "./audio/RoomAudio";
import { useHotkeys } from "./input/useHotkeys";
import Lobby from "./join/Lobby";
import SessionScreen, { type LeftAs } from "./join/SessionScreen";
import type { JoinCredentials } from "./join/useLobby";
import { useRoomConnection } from "./join/useRoomConnection";
import { RecapButton } from "./recap/RecapButton";
import { recapSnapshot, useRecapTracker } from "./recap/useRecapTracker";
import RoomView from "./RoomView";
import { voiceModePref } from "./state/prefs";
import RoomProviders from "./state/RoomProviders";
import type { RoomSession } from "./state/RoomSession";
import { useHostAutoClaim, useHostGrace } from "./state/useHostAutoClaim";
import { useRoomSounds } from "./state/useRoomSounds";

/**
 * Комната LiveKit: опции комнаты + своя, более терпеливая политика переподключения.
 * Микрофон — сохранённый; список устройств — тот, что только что видело лобби: по
 * нему выбранный микрофон просим точно.
 */
function createRoom(): Room {
  return new Room({
    ...buildRoomOptions({ inputDeviceId: getInputDevice(), devices: knownDevices() }),
    reconnectPolicy: new DefaultReconnectPolicy([...ROOM_RECONNECT_DELAYS_MS]),
  });
}

/** Ники остальных участников в порядке входа — для «Недавних» на главной. */
function othersByJoin(room: Room): string[] {
  return [...room.remoteParticipants.values()]
    .sort((a, b) => (a.joinedAt?.getTime() ?? 0) - (b.joinedAt?.getTime() ?? 0))
    .map((p) => p.name || p.identity);
}

/**
 * Комната на клиенте: лобби → подключение к LiveKit → контексты комнаты →
 * вид (RoomView). Обрывы переживает сама: короткие чинит LiveKit, после
 * окончательного — входит заново со свежим токеном (машина в @/lib/client/session).
 * Финальные экраны (выгнали, вторая вкладка, связь потеряна, вы вышли) — вместо комнаты.
 */
export default function RoomClient({ code }: { code: string }) {
  const { state, dispatch, credentialsRef } = useRoomConnection(code);
  const [room, setRoom] = useState<Room | null>(null);
  // Включён ли микрофон сейчас — чтобы, входя заново после обрыва, не включить
  // его тому, кто выключил (и наоборот). publishMic — снимок на момент обрыва:
  // его LiveKitRoom применит при следующем подключении.
  const micOnRef = useRef(true);
  const [publishMic, setPublishMic] = useState(true);

  // Ошибки этой комнаты в Sentry помечаем хэшем кода — на весь путь, с лобби.
  useEffect(() => {
    setRoomContext(code);
    return () => clearRoomContext();
  }, [code]);

  // Клик «Войти» — жест пользователя: будим звук и готовим комнату LiveKit
  // здесь, синхронно, до ожидания сети. Вход из лобби — всегда свежая комната
  // (в лобби могли выбрать другой микрофон); после обрыва входим заново ею же.
  const roomRef = useRef<Room | null>(null);
  const beforeJoin = useCallback(() => {
    void resumePlayback();
    const current = roomRef.current;
    if (!current || current.state === ConnectionState.Disconnected) {
      roomRef.current = createRoom();
      setRoom(roomRef.current);
    }
  }, []);

  const onJoined = useCallback(
    (join: TokenResponse, creds: JoinCredentials, preview: PreviewResponse | null) => {
      credentialsRef.current = creds;
      // Из лобби микрофон включается сразу — так и написано под кнопкой «Войти».
      setPublishMic(true);
      const people = (preview?.participants ?? []).map((p) => p.name).filter((n) => n !== join.name);
      rememberRoom({ code, title: join.room.title, people });
      dispatch({ type: "joined", join });
    },
    [code, credentialsRef, dispatch],
  );

  // События комнаты → машина сессии; плюс что было с микрофоном перед обрывом.
  useEffect(() => {
    if (!room) return;
    const onState = (s: ConnectionState) => {
      if (s === ConnectionState.Connected) dispatch({ type: "connected" });
    };
    const onDisconnected = (reason?: DisconnectReason) => {
      // Причину удаления сервер кладёт в нашу metadata прямо перед отключением.
      const { removed, forceMuted } = parseParticipantPublicMeta(room.localParticipant.metadata);
      const kind = classifyDisconnect(reason, removed);
      if (kind.kind === "removed") playSfx("kicked", { urgent: true });
      // Рация публикует микрофон всегда (молчит, пока не зажата клавиша); заглушённому
      // хостом публиковать нечего — сервер не даст.
      setPublishMic(!forceMuted && (voiceModePref.get() === "ptt" || micOnRef.current));
      dispatch({ type: "disconnected", kind, now: Date.now() });
    };
    const micState = (on: boolean) => (pub: TrackPublication, p: Participant) => {
      if (p.isLocal && pub.source === Track.Source.Microphone) micOnRef.current = on;
    };
    const onMuted = micState(false);
    const onUnmuted = micState(true);
    const onPublished = (pub: LocalTrackPublication) => {
      if (pub.source === Track.Source.Microphone) micOnRef.current = !pub.isMuted;
    };
    room
      .on(RoomEvent.ConnectionStateChanged, onState)
      .on(RoomEvent.Disconnected, onDisconnected)
      .on(RoomEvent.TrackMuted, onMuted)
      .on(RoomEvent.TrackUnmuted, onUnmuted)
      .on(RoomEvent.LocalTrackPublished, onPublished);
    return () => {
      room
        .off(RoomEvent.ConnectionStateChanged, onState)
        .off(RoomEvent.Disconnected, onDisconnected)
        .off(RoomEvent.TrackMuted, onMuted)
        .off(RoomEvent.TrackUnmuted, onUnmuted)
        .off(RoomEvent.LocalTrackPublished, onPublished);
    };
  }, [room, dispatch]);

  // Ушли со страницы или закрыли вкладку — освежаем «Недавние» составом комнаты.
  const join = state.stage === "lobby" ? null : state.join;
  const title = join?.room.title ?? null;
  useEffect(() => {
    if (!room || !title) return;
    const remember = () => rememberRoom({ code, title, people: othersByJoin(room) });
    window.addEventListener("pagehide", remember);
    return () => {
      window.removeEventListener("pagehide", remember);
      remember();
    };
  }, [room, title, code]);

  // «Выйти» → экран «Вы вышли» с «Вернуться» (решение М7): промахнуться мимо
  // кнопки в клубе легко, а вход заново без лобби — один клик. LiveKit
  // отключится сам: смена экрана размонтирует комнату. Кем вышли — для пояснения
  // хосту, что будет с правами.
  const [leftAs, setLeftAs] = useState<LeftAs | null>(null);
  // Итоги вечера — снимок в момент выхода: на экране «Вы вышли» их можно скачать.
  const [leftRecap, setLeftRecap] = useState<Recap | null>(null);
  const config = usePublicConfig(code) ?? FALLBACK_PUBLIC_CONFIG;
  const leave = useCallback(() => {
    if (!room || !join) return;
    rememberRoom({ code, title: join.room.title, people: othersByJoin(room) });
    setLeftRecap(recapSnapshot(code, Date.now()));
    const meta = parseRoomPublicMeta(room.metadata);
    setLeftAs({
      wasHost: !!meta && meta.hostIdentity === join.identity,
      isOwner: meta?.ownerIdentity ? meta.ownerIdentity === join.identity : join.isOwner,
    });
    dispatch({ type: "left" });
  }, [room, join, code, dispatch]);

  // Технический текст сбоя подключения — только в Sentry; экран выбирает машина
  // сессии по событию Disconnected. Ошибки микрофона сюда тоже приходят — их
  // показывает MicProvider, а запрет публикации (хост заглушил) — норма.
  const onError = useCallback(
    (e: Error) => {
      if (!(e instanceof ConnectionError)) return;
      withSentry((Sentry) => Sentry.captureException(e, { tags: { area: "room-connect" } }));
      // Сбой до смены состояния не даст события Disconnected — сообщаем сами.
      if (room?.state === ConnectionState.Disconnected) {
        dispatch({ type: "disconnected", kind: { kind: "drop" }, now: Date.now() });
      }
    },
    [room, dispatch],
  );

  const rejoining = isRejoining(state);
  const session = useMemo<RoomSession | null>(
    () =>
      join && {
        code,
        title: join.room.title,
        token: join.token,
        identity: join.identity,
        name: join.name,
        isOwner: join.isOwner,
        rejoining,
      },
    [code, join, rejoining],
  );

  if (state.stage === "lobby") {
    return <Lobby code={code} notice={state.notice} beforeJoin={beforeJoin} onJoined={onJoined} />;
  }
  if (state.stage === "ended") {
    return (
      <SessionScreen
        view={endScreenView(state.screen)}
        code={code}
        title={state.join?.room.title}
        onRetry={() => dispatch({ type: "retry", now: Date.now() })}
        retrying={state.retrying}
        error={state.error?.message ?? null}
        leftAs={state.screen.kind === "left" ? (leftAs ?? undefined) : undefined}
        extra={
          state.screen.kind === "left" && config.flags.recap && leftRecap && recapWorthShowing(leftRecap) ? (
            <RecapButton recap={leftRecap} />
          ) : undefined
        }
      />
    );
  }
  // Комнату LiveKit готовит клик «Войти» раньше, чем приходит токен.
  if (!room || !session) return null;

  return (
    <LiveKitRoom
      room={room}
      serverUrl={state.join.serverUrl}
      token={state.join.token}
      connect={shouldConnect(state)}
      // Микрофон публикуем сразу при входе, а при входе заново — как было до обрыва.
      audio={publishMic}
      video={false}
      onError={onError}
      className="flex flex-1 flex-col"
    >
      <RoomProviders session={session} onLeave={leave}>
        <RoomAudio />
        <RoomBehavior />
        <RoomView />
      </RoomProviders>
    </LiveKitRoom>
  );
}

/** Невидимое поведение комнаты: автопередача хоста, звуки по событиям, горячие клавиши, фокус. */
function RoomBehavior() {
  const graceOver = useHostGrace();
  useHostAutoClaim(graceOver);
  useRoomSounds(graceOver);
  useRecapTracker();
  useHotkeys();
  useFocusAfterEntry();
  return null;
}

/**
 * Фокус после входа. Лобби (или экран «Вы вышли») исчезло из-под фокуса, и он
 * упал на body: человеку с клавиатурой пришлось бы начинать с начала страницы,
 * а скринридер не понял бы, что открылась комната. Один раз после первого
 * подключения ставим фокус на `[data-autofocus]` комнаты — что это, решает
 * RoomView (зона комнаты). Фокус уже где-то стоит (успели кликнуть) — не
 * трогаем; входы заново после обрыва — тоже: RoomBehavior живёт дальше.
 */
function useFocusAfterEntry() {
  const state = useConnectionState();
  const doneRef = useRef(false);
  useEffect(() => {
    if (doneRef.current || state !== ConnectionState.Connected) return;
    doneRef.current = true;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    document.querySelector<HTMLElement>('[data-testid="room"] [data-autofocus]')?.focus({ preventScroll: true });
  }, [state]);
}

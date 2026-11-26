"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnectionState, useRoomContext } from "@livekit/components-react";
import { ConnectionState, RoomEvent, type RemoteParticipant } from "livekit-client";
import { CHAT_TOPIC, type ChatMessage } from "@/lib/api/contract";
import { fetchChatHistory, sendChatMessage } from "@/lib/client/api";
import {
  appendEntry,
  confirmEntry,
  decodeChatPacket,
  failEntry,
  localId,
  mergeHistory,
  pendingEntry,
  receiveMessage,
  retryEntry,
  type ChatEntry,
} from "@/lib/client/chat";
import { ApiError, networkError, type ClientErrorCode } from "@/lib/client/errors";
import { useLatestRef } from "../state/useLatestRef";
import { useRoomSession } from "../state/RoomSession";

const SILENT_REASONS: ReadonlySet<ClientErrorCode> = new Set<ClientErrorCode>([
  "NETWORK",
  "SERVICE_UNAVAILABLE",
  "SERVER_ERROR",
]);

export type ChatFeed = {
  entries: readonly ChatEntry[];
  /** Своя identity — свои сообщения справа не рисуем, но знаем «моё». */
  myIdentity: string;
  /** Отправить: сразу видно в ленте (pending), не ушло — помечается «Не отправлено». */
  send: (text: string) => void;
  /** «Повторить» для не ушедшего сообщения. */
  retry: (id: string) => void;
};

/**
 * Лента чата комнаты. Отправка — POST /api/chat; приём — data-пакеты LiveKit с
 * темой CHAT_TOPIC ТОЛЬКО от сервера (participant пустой: свои пакеты клиентам
 * запрещены, а пакет от участника — подделка, его отбрасываем). История —
 * GET /api/chat при каждом подключении (и после переподключения: пакеты за время
 * обрыва потерялись). Один id из трёх путей склеивается (см. @/lib/client/chat).
 * onIncoming зовётся для каждого НОВОГО живого сообщения от других.
 */
export function useChatFeed(onIncoming: (message: ChatMessage) => void): ChatFeed {
  const room = useRoomContext();
  const state = useConnectionState();
  const { code, token, identity } = useRoomSession();
  const [entries, setEntries] = useState<readonly ChatEntry[]>([]);
  const entriesRef = useLatestRef(entries);
  const tokenRef = useLatestRef(token);
  const onIncomingRef = useLatestRef(onIncoming);
  const seqRef = useRef(0);

  // Живые сообщения от сервера.
  useEffect(() => {
    const onData = (
      payload: Uint8Array,
      participant?: RemoteParticipant,
      _kind?: unknown,
      topic?: string,
    ) => {
      if (topic !== CHAT_TOPIC || participant) return;
      const message = decodeChatPacket(payload);
      if (!message) return;
      const fresh = !entriesRef.current.some((e) => e.id === message.id);
      setEntries((list) => receiveMessage(list, message, identity));
      if (fresh && message.from.identity !== identity) onIncomingRef.current(message);
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room, identity, entriesRef, onIncomingRef]);

  // История — при каждом входе в состояние «на связи».
  const connected = state === ConnectionState.Connected;
  useEffect(() => {
    if (!connected) return;
    const ctrl = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const load = (attempt: number) => {
      fetchChatHistory(code, token, ctrl.signal).then(
        (history) => setEntries((list) => mergeHistory(list, history, identity)),
        (err: unknown) => {
          // Сервер мог ещё не увидеть нас в комнате — одна повторная попытка.
          if (attempt === 0 && err instanceof ApiError && err.code === "NOT_IN_ROOM") {
            retryTimer = setTimeout(() => load(1), 2000);
          }
        },
      );
    };
    load(0);
    return () => {
      ctrl.abort();
      clearTimeout(retryTimer);
    };
  }, [connected, code, token, identity]);

  const post = useCallback(
    (id: string, text: string) => {
      sendChatMessage(code, tokenRef.current, text).then(
        (message) => setEntries((list) => confirmEntry(list, id, message)),
        (err: unknown) => {
          const error = err instanceof ApiError ? err : networkError();
          // Причину пишем, только если она что-то объясняет («Хост выключил чат»,
          // «Слишком часто»); про сеть и так понятно из «Не отправлено».
          const reason = SILENT_REASONS.has(error.code) ? "" : error.message;
          setEntries((list) => failEntry(list, id, reason));
        },
      );
    },
    [code, tokenRef],
  );

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      const id = localId(++seqRef.current);
      const me = { identity, name: room.localParticipant.name || identity };
      setEntries((list) => appendEntry(list, pendingEntry(id, me, text, Date.now())));
      post(id, text);
    },
    [identity, room, post],
  );

  const retry = useCallback(
    (id: string) => {
      const entry = entriesRef.current.find((e) => e.id === id);
      if (!entry || entry.state !== "failed") return;
      setEntries((list) => retryEntry(list, id));
      post(id, entry.text);
    },
    [entriesRef, post],
  );

  return useMemo(() => ({ entries, myIdentity: identity, send, retry }), [entries, identity, send, retry]);
}

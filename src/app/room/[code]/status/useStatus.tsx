"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useConnectionState, useRoomContext } from "@livekit/components-react";
import { ConnectionState, ParticipantEvent, type Participant } from "livekit-client";
import { toast } from "@/components/ui/Toast";
import { NO_STATUS, STATUS_ATTRIBUTES, parseStatusAttributes, type PublicStatus } from "@/lib/api/contract";
import { sendStatus } from "@/lib/client/api";
import { isApiError } from "@/lib/client/errors";
import { useRoomSession } from "../state/RoomSession";

/** Пауза перед отправкой: человек ещё печатает «во что играю». */
const SEND_DELAY_MS = 600;
/** Сбой сети — повторим не раньше чем через столько. */
const RETRY_MS = 5_000;

const readKind = (p: Participant) => p.attributes?.[STATUS_ATTRIBUTES.kind] ?? "";
const readText = (p: Participant) => p.attributes?.[STATUS_ATTRIBUTES.text] ?? "";

/**
 * Статус участника так, как его видят все: из атрибутов LiveKit (пишет сервер
 * по POST /api/status). Перерисовывает только смена атрибутов этого участника.
 */
export function useStatusAttributes(p: Participant): PublicStatus {
  const subscribe = useCallback(
    (onChange: () => void) => {
      p.on(ParticipantEvent.AttributesChanged, onChange);
      return () => {
        p.off(ParticipantEvent.AttributesChanged, onChange);
      };
    },
    [p],
  );
  const kind = useSyncExternalStore(
    subscribe,
    () => readKind(p),
    () => "",
  );
  const text = useSyncExternalStore(
    subscribe,
    () => readText(p),
    () => "",
  );
  return useMemo(
    () => parseStatusAttributes({ [STATUS_ATTRIBUTES.kind]: kind, [STATUS_ATTRIBUTES.text]: text }),
    [kind, text],
  );
}

type StatusContextValue = { status: PublicStatus; setStatus: (next: PublicStatus) => void };
const StatusContext = createContext<StatusContextValue>({ status: NO_STATUS, setStatus: () => {} });

/** Свой статус и как его поменять (поповер в доке). */
export function useMyStatus(): StatusContextValue {
  return useContext(StatusContext);
}

const same = (a: PublicStatus, b: PublicStatus) => a.kind === b.kind && a.text === b.text;

/**
 * Свой статус: что выбрал человек (status) и синхронизация с атрибутами. Шлём с
 * паузой, по одному запросу и сверяясь со своими атрибутами — поэтому после
 * входа заново (в новой сессии атрибутов нет) статус уходит снова сам. Сервер
 * отказал по делу (флаг выключен, мусор) — статус снимается и тост говорит
 * почему; сбой сети — тихо повторим позже. Живёт, пока открыта комната.
 */
export function StatusProvider({ children }: { children: ReactNode }) {
  const room = useRoomContext();
  const { code, token } = useRoomSession();
  const connected = useConnectionState(room) === ConnectionState.Connected;
  const shown = useStatusAttributes(room.localParticipant);
  const [status, setStatus] = useState<PublicStatus>(NO_STATUS);
  const inFlight = useRef(false);
  const retryAt = useRef(0);
  const [tick, recheck] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!connected || inFlight.current || same(status, shown)) return;
    const wanted = status;
    const timer = setTimeout(
      () => {
        inFlight.current = true;
        void sendStatus(code, token, wanted)
          .catch((err: unknown) => {
            // Отказ по делу — повторять бесполезно; остальное (сеть, лимит, переподключение) — повторим.
            if (isApiError(err) && (err.code === "FEATURE_DISABLED" || err.code === "BAD_REQUEST")) {
              setStatus(NO_STATUS);
              toast({ id: "status-failed", icon: "info", title: err.message, immediate: true });
              return;
            }
            const wait = isApiError(err) && err.retryAfterSec ? err.retryAfterSec * 1000 : RETRY_MS;
            retryAt.current = Date.now() + wait;
          })
          .finally(() => {
            inFlight.current = false;
            recheck();
          });
      },
      Math.max(SEND_DELAY_MS, retryAt.current - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [connected, code, token, status, shown, tick]);

  const value = useMemo(() => ({ status, setStatus }), [status]);
  return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>;
}

"use client";

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { useConnectionState, useLocalParticipant, useRoomContext } from "@livekit/components-react";
import {
  ConnectionState,
  ParticipantEvent,
  RoomEvent,
  Track,
  TrackEvent,
  type LocalAudioTrack,
  type LocalTrackPublication,
} from "livekit-client";
import { toast } from "@/components/ui";
import type { DeviceInfo } from "@/lib/audio/devices";
import { micError, toMicError, type MicError } from "@/lib/audio/micErrors";
import { playSfx } from "@/lib/audio/sfx";
import {
  INITIAL_MIC_INTENT,
  micIntentReducer,
  micState,
  shouldTransmit,
  type MicState,
} from "@/lib/audio/voiceState";
import type { VoiceMode } from "@/lib/clientStorage";
import { voiceModePref } from "../state/prefs";
import { useLatestRef } from "../state/useLatestRef";
import { usePersistentState } from "../state/usePersistentState";
import { useForceMuted, useMyPermissions } from "../state/useRoomMeta";
import { getMicTrack, useMicTrack } from "./micTrack";
import { useDeafen } from "./useDeafen";
import { useMicCapture, type MicCapture } from "./useMicCapture";
import { useMicPipeline, type MicPipeline } from "./useMicPipeline";
import { usePushToTalk } from "./usePushToTalk";
import { useVoicePresence } from "./useVoicePresence";

export type { MicError, MicState };

/** Свой микрофон — для дока, баннеров и звуков. */
export type Mic = {
  /** Вид кнопки микрофона (как MicState в макете): on / off / ptt-idle / ptt-talk / forced. */
  state: MicState;
  /** Режим голоса: открытый микрофон или рация. */
  mode: VoiceMode;
  /** Микрофон включён; в рации — «рация готова». Намерение человека: «Звук выкл» его не меняет. */
  enabled: boolean;
  /** Звук реально уходит в эфир (трек опубликован и не заглушён). */
  live: boolean;
  /** Микрофон включается — кнопку блокируем. */
  pending: boolean;
  /** Хост выключил микрофон — включить его снова может только хост. */
  forceMuted: boolean;
  /** Микрофон не открылся — вас не слышно; null — всё в порядке. Тексты готовы для баннера. */
  error: MicError | null;
  /** Микрофон вкл/выкл со звуком — то же, что useRoomActions().toggleMic. */
  toggle: () => void;
  /** Открыть микрофон заново после ошибки (кнопка «Повторить» в баннере). */
  retry: () => void;
  /**
   * Рация с экрана: кнопку микрофона нажали (true) / отпустили (false). Работает
   * как клавиша рации: та же задержка отпускания (pttReleasePref) и те же звуки
   * mic-on / mic-off; клавиша и палец складываются, blur окна закрывает эфир.
   * Пока рация не активна (не режим рации, выключена, «звук выкл», хост
   * заглушил) — ничего не делает. Ссылка стабильная.
   */
  pttHold: (down: boolean) => void;
};

/** Всё про обработку и захват — для окна настроек. */
export type VoiceControls = MicPipeline &
  MicCapture & {
    mode: VoiceMode;
    live: boolean;
    state: MicState;
    track: LocalAudioTrack | undefined;
  };

const MicContext = createContext<Mic | null>(null);
const VoiceContext = createContext<VoiceControls | null>(null);

/** Флаг вне React с подпиской — для useSyncExternalStore. */
function createFlag() {
  let value = false;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: boolean) {
      if (next === value) return;
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

/**
 * Владелец своего микрофона. Намерение человека (включён / рация готова) живёт
 * здесь, а трек только догоняет посчитанное «идёт ли звук в эфир» (shouldTransmit
 * из @/lib/audio/voiceState): открытый микрофон, рация (клавиша зажата), «Звук
 * выкл» (как в Discord — глушит и микрофон, снятие возвращает как было) и
 * заглушение хостом сводятся в одно правило. Трек при этом остаётся
 * опубликованным: выключение — mute, мгновенное и без нового getUserMedia.
 *
 * Обработка звука — useMicPipeline, захват и устройства — useMicCapture.
 */
export function MicProvider({ children }: { children: ReactNode }) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const connection = useConnectionState(room);
  const connected = connection === ConnectionState.Connected;
  // Говорить нельзя: хост заглушил (metadata) или сервер не даёт публиковать
  // микрофон (права LiveKit — приходят иногда раньше metadata). До подключения
  // прав ещё нет — это не запрет.
  const { canSpeak } = useMyPermissions();
  const forceMuted = useForceMuted(localParticipant) || (connected && !canSpeak);
  const [mode] = usePersistentState(voiceModePref);
  const deafen = useDeafen();
  const { track, muted } = useMicTrack(localParticipant);

  const [error, setError] = useState<MicError | null>(null);
  const [intent, dispatch] = useReducer(micIntentReducer, INITIAL_MIC_INTENT);
  // Смена режима и заглушение хостом меняют намерение (вход в рацию готовит её,
  // выход возвращает как было; после хоста человек включает микрофон сам — в
  // том числе если зашёл уже заглушённым).
  const [seenMode, setSeenMode] = useState(mode);
  if (seenMode !== mode) {
    setSeenMode(mode);
    dispatch({ type: "mode", mode, forceMuted });
  }
  const [seenForced, setSeenForced] = useState(false);
  if (seenForced !== forceMuted) {
    setSeenForced(forceMuted);
    if (forceMuted) {
      dispatch({ type: "force-muted" });
      // Причина известна (хост) — ошибку захвата, случившуюся в эту секунду, не показываем.
      setError(null);
    }
  }

  // «Микрофон публикуется» — состояние LiveKit, а не React: держим во внешнем
  // флаге, чтобы эффект ниже мог начать публикацию, не дёргая setState.
  const [publishingFlag] = useState(createFlag);
  const publishing = useSyncExternalStore(publishingFlag.subscribe, publishingFlag.get, () => false);
  const live = !!track && !muted;

  const ptt = usePushToTalk(mode === "ptt" && intent.enabled && !forceMuted && !deafen.deafened);
  const pttHeld = ptt.held;
  const inputs = { mode, enabled: intent.enabled, pttHeld, deafened: deafen.deafened, forceMuted };
  const transmit = shouldTransmit(inputs);
  const state = micState(inputs);

  // «Звук выкл» и рацию видят другие. Рация — это готовность (режим + включена),
  // а не зажатая клавиша: эфир и так виден по треку, а каждое нажатие слать незачем.
  useVoicePresence({ deafened: deafen.deafened, ptt: mode === "ptt" && intent.enabled });

  const pipeline = useMicPipeline({ track, live, identity: localParticipant.identity });

  // Список устройств изменился, а микрофона нет — пробуем снова сами (вставили
  // гарнитуру, закрыли программу, которая держала микрофон).
  const retryRef = useRef<() => void>(() => {});
  const errorRef = useLatestRef(error);
  const onDevicesChanged = useCallback(
    (devices: DeviceInfo[]) => {
      const e = errorRef.current;
      if (e && e.kind !== "denied" && devices.some((d) => d.kind === "audioinput")) retryRef.current();
    },
    [errorRef],
  );
  const capture = useMicCapture({
    room,
    track,
    ourNoiseSuppression: !pipeline.browserNoiseSuppression,
    onError: setError,
    onDevicesChanged,
  });

  // Трек догоняет «идёт ли звук в эфир». muted в зависимостях — чтобы вернуть
  // как надо, если трек заглушили или открыли снаружи (LiveKit при входе
  // публикует открытым, после неудачного переоткрытия — глушит). Заглушение
  // хостом «всем» сюда не доходит: его раньше превращает в выключенный микрофон
  // обработчик remoteMute ниже.
  const [syncTick, resync] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!track) return;
    (transmit ? track.unmute() : track.mute()).catch((e: unknown) => setError(toMicError(e)));
  }, [track, transmit, muted, syncTick]);

  // Только что опубликованный микрофон (вход в комнату) глушим сразу, в том же
  // событии, если звук сейчас не должен идти (рация, выключен) — до перерисовки.
  const transmitRef = useLatestRef(transmit);
  useEffect(() => {
    const onPublished = (pub: LocalTrackPublication) => {
      if (pub.source === Track.Source.Microphone && !transmitRef.current) void pub.track?.mute();
    };
    localParticipant.on(ParticipantEvent.LocalTrackPublished, onPublished);
    return () => {
      localParticipant.off(ParticipantEvent.LocalTrackPublished, onPublished);
    };
  }, [localParticipant, transmitRef]);

  // Микрофон открылся заново (наш перезапуск, «Повторить» или LiveKit сам при
  // снятии mute) — значит, он работает: ошибку снимаем. Только по успеху: трек
  // после неудачного перезапуска остаётся «не заглушённым», но мёртвым.
  useEffect(() => {
    if (!track) return;
    const recovered = () => setError(null);
    track.on(TrackEvent.Restarted, recovered);
    return () => {
      track.off(TrackEvent.Restarted, recovered);
    };
  }, [track]);

  // Ошибки захвата при входе (LiveKitRoom публикует сам). Ошибки экрана (отмена
  // окна выбора) приходят тем же событием без kind — они не про микрофон.
  useEffect(() => {
    const onDeviceError = (e: Error, kind?: MediaDeviceKind) => {
      if (kind === "audioinput") setError(toMicError(e));
    };
    room.on(RoomEvent.MediaDevicesError, onDeviceError);
    return () => {
      room.off(RoomEvent.MediaDevicesError, onDeviceError);
    };
  }, [room]);

  /**
   * Опубликовать микрофон. open — открытым (setMicrophoneEnabled: если LiveKitRoom
   * как раз публикует свой при входе, LiveKit дождётся его, второго трека не будет).
   * Не open — сразу заглушённым, для рации: ни одного кадра до нажатия клавиши.
   */
  const publish = useCallback(
    async (open: boolean) => {
      if (publishingFlag.get()) return;
      publishingFlag.set(true);
      try {
        if (open) {
          await localParticipant.setMicrophoneEnabled(true);
        } else {
          const [t] = await localParticipant.createTracks({ audio: true });
          try {
            await t.mute();
            await localParticipant.publishTrack(t);
          } catch (e) {
            t.stop();
            throw e;
          }
        }
        // LiveKit мог не дождаться чужой публикации и вернуться без трека. Тогда
        // ошибку обычно уже сообщило MediaDevicesError; если нет — своя, чтобы
        // эффект ниже не повторял публикацию по кругу.
        if (getMicTrack(localParticipant)) setError(null);
        else setError((prev) => prev ?? micError("unknown"));
      } catch (e) {
        setError(toMicError(e));
      } finally {
        publishingFlag.set(false);
      }
    },
    [localParticipant, publishingFlag],
  );

  // Звук должен идти, а трека нет (выключили до обрыва и после переподключения
  // его не опубликовали, вернул хост, нажали рацию) — публикуем. Ошибка
  // останавливает попытки до «Повторить» или нового устройства.
  useEffect(() => {
    if (!connected || track || !transmit || publishing || error) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- публикация — внешняя система (LiveKit); ошибку publish пишет асинхронно, после ответа браузера и сервера
    void publish(true);
  }, [connected, track, transmit, publishing, error, publish]);

  /** Рация готова, а трека нет — публикуем заглушённым заранее: первое нажатие сразу в эфир. */
  const prepareRadio = useCallback(() => {
    if (!getMicTrack(localParticipant)) void publish(false);
  }, [localParticipant, publish]);

  const toggle = useCallback(() => {
    if (forceMuted || publishing) return;
    const turningOn = deafen.deafened || !intent.enabled;
    if (!turningOn) {
      playSfx("mic-off");
      dispatch({ type: "set", enabled: false });
      return;
    }
    // Как в Discord: включить микрофон при «Звук выкл» — значит вернуть и звук.
    // urgent — флаг «звук выкл» в sfx ещё не снят и иначе заглушил бы щелчок.
    playSfx("mic-on", deafen.deafened ? { urgent: true } : undefined);
    if (deafen.deafened) deafen.set(false);
    dispatch({ type: "set", enabled: true });
    // Открытый микрофон опубликует эффект выше (звук должен пойти), рацию — готовим.
    if (mode === "ptt") prepareRadio();
  }, [forceMuted, publishing, deafen, intent.enabled, mode, prepareRadio]);

  // «Выключить микрофоны всем»: сервер глушит трек (mutePublishedTrack), LiveKit
  // исполняет. Это решение хоста, а не сбой — выключаем микрофон по-настоящему,
  // иначе эффект «трек догоняет эфир» выше через миг снял бы заглушение. Право
  // говорить остаётся: включить можно самому, в том числе кнопкой в тосте.
  //
  // Событие сервера берём у движка комнаты (room.engine — @internal, но с типами:
  // переименуют в livekit-client — упадёт tsc). По одному факту «трек заглушён»
  // хоста не отличить от LiveKit, который глушит трек после неудачного
  // переоткрытия выдернутого микрофона, — а такой трек мы как раз открываем сами.
  // После окончательного обрыва движок новый — подписываемся при каждом подключении.
  const remoteMuteRef = useLatestRef({ enabled: intent.enabled, deafened: deafen.deafened, forceMuted, toggle });
  useEffect(() => {
    if (!connected) return;
    const engine = room.engine;
    const onRemoteMute = (trackSid: string, muted: boolean) => {
      if (!muted || localParticipant.getTrackPublication(Track.Source.Microphone)?.trackSid !== trackSid) return;
      const was = remoteMuteRef.current;
      // Синхронно: LiveKit доглушит трек микрозадачей позже, и перерисовка по
      // «трек заглушён» со старым намерением на миг сняла бы заглушение.
      flushSync(() => dispatch({ type: "muted-remotely" }));
      // Заглушённому хостом всё объясняет плашка, а выключенному сообщать нечего.
      if (was.forceMuted || !was.enabled) return;
      playSfx("force-muted", { urgent: true });
      toast({
        id: "mic-muted-all",
        tone: "caution",
        icon: "mic-off",
        title: "Хост выключил всем микрофоны",
        description: "Включите свой, когда нужно",
        action: {
          label: "Включить",
          onClick: () => {
            const now = remoteMuteRef.current;
            if (!now.enabled || now.deafened) now.toggle();
          },
        },
      });
    };
    engine.on("remoteMute", onRemoteMute);
    return () => {
      engine.off("remoteMute", onRemoteMute);
    };
  }, [room, connected, localParticipant, remoteMuteRef]);

  const intentRef = useLatestRef(intent);
  const retry = useCallback(() => {
    setError(null);
    void (async () => {
      try {
        const hadTrack = await capture.recapture();
        if (!hadTrack && mode === "ptt" && intentRef.current.enabled && !forceMuted) prepareRadio();
        resync();
      } catch (e) {
        setError(toMicError(e));
      }
    })();
  }, [capture, intentRef, forceMuted, mode, prepareRadio]);
  useEffect(() => {
    retryRef.current = retry;
  }, [retry]);

  // Нет доступа: как только человек разрешит микрофон в браузере — пробуем сами.
  const errorKind = error?.kind;
  useEffect(() => {
    if (errorKind !== "denied" || !navigator.permissions?.query) return;
    let alive = true;
    let status: PermissionStatus | null = null;
    const onChange = () => {
      if (status?.state === "granted") retryRef.current();
    };
    navigator.permissions.query({ name: "microphone" as PermissionName }).then(
      (s) => {
        if (!alive) return;
        status = s;
        s.addEventListener("change", onChange);
      },
      () => {
        // Firefox старых версий не знает имени «microphone» — остаётся кнопка «Повторить».
      },
    );
    return () => {
      alive = false;
      status?.removeEventListener("change", onChange);
    };
  }, [errorKind]);

  const mic = useMemo<Mic>(
    () => ({
      state,
      mode,
      enabled: intent.enabled,
      live,
      pending: publishing,
      forceMuted,
      error,
      toggle,
      retry,
      pttHold: ptt.hold,
    }),
    [state, mode, intent.enabled, live, publishing, forceMuted, error, toggle, retry, ptt.hold],
  );
  const voice = useMemo<VoiceControls>(
    () => ({ ...pipeline, ...capture, mode, live, state, track }),
    [pipeline, capture, mode, live, state, track],
  );
  return (
    <MicContext value={mic}>
      <VoiceContext value={voice}>{children}</VoiceContext>
    </MicContext>
  );
}

export function useMic(): Mic {
  const value = use(MicContext);
  if (!value) throw new Error("useMic: нет MicProvider выше по дереву");
  return value;
}

/** Обработка, захват и устройства своего микрофона — для окна настроек. */
export function useVoiceControls(): VoiceControls {
  const value = use(VoiceContext);
  if (!value) throw new Error("useVoiceControls: нет MicProvider выше по дереву");
  return value;
}

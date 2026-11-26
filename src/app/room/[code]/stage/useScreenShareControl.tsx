"use client";

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useRoomContext } from "@livekit/components-react";
import {
  ParticipantEvent,
  Track,
  type LocalAudioTrack,
  type LocalTrackPublication,
  type LocalVideoTrack,
} from "livekit-client";
import { toast } from "@/components/ui";
import { playSfx } from "@/lib/audio/sfx";
import {
  SCREEN_AUDIO_PUBLISH,
  SCREEN_PRESETS,
  captureErrorText,
  displayMediaOptions,
  liveSwitch,
  screenDegradation,
  screenShareSupported,
  screenStartBitrateKbps,
  screenVideoPublishOptions,
  withStartBitrate,
  type CaptureSize,
  type LiveSwitch,
  type ScreenQuality,
} from "@/lib/screenShare";
import { clampScreenQuality } from "@/lib/client/screenCap";
import { screenQualityPref } from "../state/prefs";
import { useLatestRef } from "../state/useLatestRef";
import { usePersistentState } from "../state/usePersistentState";
import { useRoomConfig } from "../state/useRoomConfig";
import { useMyPermissions } from "../state/useRoomMeta";

/** Что видят друзья: размер и частота кадров идущего показа. */
export type CaptureInfo = CaptureSize;

/** Своя демонстрация экрана: состояние для дока, стола и настроек + управление. */
export type ScreenShareControl = {
  /** Показ идёт. */
  enabled: boolean;
  /** Запуск, остановка или перезапуск в процессе — кнопку блокируем. */
  pending: boolean;
  /** Можно начать показ: браузер умеет и сервер разрешает. */
  allowed: boolean;
  /** Почему нельзя — подсказка к кнопке «Экран». */
  blockedReason: string | null;
  /** Размер и частота захвата идущего показа. */
  capture: CaptureInfo | null;
  /** Новый профиль на лету раскрылся не целиком — поможет «Перезапустить показ». */
  restartAdvised: boolean;
  /** Что именно даст перезапуск — подпись под кнопкой; null — профиль работает целиком. */
  restartHint: string | null;
  /** Вкл/выкл — то же, что useRoomActions().toggleScreenShare. Только из жеста. */
  toggle: () => void;
  stop: () => void;
  /**
   * Выбрать экран заново. Старый показ идёт, пока не выбрали новый: отмена окна
   * выбора ничего не ломает. Только из жеста (клик, клавиша).
   */
  restart: () => void;
};

const ScreenShareContext = createContext<ScreenShareControl | null>(null);

/** Идущий показ: свои дорожки LiveKit и профили. */
type ActiveShare = {
  video: LocalVideoTrack;
  audio: LocalAudioTrack | null;
  /** Что захватили при старте и с каким профилем — от этого считается смена на лету. */
  capture: CaptureInfo;
  capturedWith: ScreenQuality;
  /** Профиль, под который сейчас настроен кодировщик. */
  quality: ScreenQuality;
  /** Остановили мы сами (кнопка, клавиша), а не браузер или сервер. */
  stoppedByMe: boolean;
};

const noSubscribe = () => () => {};

/** Почему советуем перезапуск: то, что не раскрылось на лету, или сбой браузера. */
type RestartReason = NonNullable<LiveSwitch["restart"]> | "failed";

const RESTART_HINT: Record<RestartReason, string> = {
  frames: "Больше кадров в секунду будет после перезапуска показа",
  layer: "Запасной слой для слабого интернета появится после перезапуска показа",
  pixels: "Если экран крупнее нынешнего захвата, разрешение вырастет после перезапуска",
  failed: "Новое качество включится после перезапуска показа",
};

/**
 * Дорожки, которые закончил сам браузер («Прекратить доступ» в его панели,
 * закрытое окно). Слушатель ставим до публикации — раньше LiveKit, который по
 * тому же событию сразу снимает дорожку. Остальные концы, кроме своей кнопки, —
 * это сервер, то есть хост.
 */
const endedByBrowser = new WeakSet<MediaStreamTrack>();

/** Стартовая оценка канала для своих показов: дорожка → кбит/с (уходит вместе с дорожкой). */
const startBitrates = new WeakMap<MediaStreamTrack, number>();
let startBitrateHooked = false;

/**
 * Подсказать Chrome стартовую оценку канала для показа (screenStartBitrateKbps):
 * иначе верхний слой включается только через ~20 с. Стандартного API нет, есть
 * x-google-start-bitrate в SDP. LiveKit так делает сам, но лишь для SVC-кодеков
 * (PCTransport) — для H.264/VP8 дописываем параметр в ответ сервера: отправку
 * Chrome настраивает по нему. Трогаем только видеосекцию своего показа и только
 * ответы; браузер правку не принял — ответ уходит как был: показ важнее разгона.
 * Firefox и Safari параметр молча пропускают.
 *
 * Обёртка общая для страницы (RTCPeerConnection у LiveKit внутренний), ставится
 * при первом показе. Правим каждый ответ, пока показ жив: одинаковый параметр
 * не меняет кодек отправки и не сбрасывает уже набранную оценку канала.
 */
function hintStartBitrate(track: MediaStreamTrack, kbps: number): void {
  startBitrates.set(track, kbps);
  if (startBitrateHooked || typeof RTCPeerConnection === "undefined") return;
  startBitrateHooked = true;
  // Старая форма с колбэками (legacy) проходит насквозь — LiveKit ею не пользуется.
  const original = RTCPeerConnection.prototype.setRemoteDescription as (
    this: RTCPeerConnection,
    description: RTCSessionDescriptionInit,
    ...legacy: unknown[]
  ) => Promise<void>;
  RTCPeerConnection.prototype.setRemoteDescription = async function setRemoteDescription(
    this: RTCPeerConnection,
    description: RTCSessionDescriptionInit,
    ...legacy: unknown[]
  ): Promise<void> {
    const sdp = legacy.length === 0 && description?.type === "answer" ? withShareStartBitrates(this, description.sdp) : null;
    if (sdp) {
      try {
        return await original.call(this, { type: "answer", sdp });
      } catch {
        // правка не подошла — ниже ответ как есть
      }
    }
    return original.call(this, description, ...legacy);
  };
}

/** Ответ с подсказкой для всех своих показов в этом соединении; null — менять нечего. */
function withShareStartBitrates(pc: RTCPeerConnection, sdp: string | undefined): string | null {
  if (!sdp) return null;
  let out = sdp;
  for (const t of pc.getTransceivers()) {
    const kbps = t.sender.track ? startBitrates.get(t.sender.track) : undefined;
    if (kbps && t.mid) out = withStartBitrate(out, t.mid, kbps);
  }
  return out === sdp ? null : out;
}

const captureOf = (track: MediaStreamTrack, q: ScreenQuality): CaptureInfo => {
  const s = track.getSettings();
  return {
    width: s.width ?? 0,
    height: s.height ?? 0,
    frameRate: s.frameRate ?? SCREEN_PRESETS[q].frameRate,
  };
};

/**
 * Окно выбора экрана. null — закрыли окно (молчим) или сбой (тост уже показан).
 */
async function captureScreen(q: ScreenQuality): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getDisplayMedia(displayMediaOptions(q));
  } catch (e) {
    const text = captureErrorText(e instanceof Error ? e : {});
    if (text) toast({ id: "screen-error", tone: "alert", title: "Показ экрана не начался", description: text });
    return null;
  }
}

/**
 * Владелец своей демонстрации. Захват и публикацию делаем сами, а не через
 * setScreenShareEnabled LiveKit:
 *  • картинке и звуку нужны разные опции публикации (звук экрана — стерео
 *    128 кбит/с без голосовых DTX/RED, см. @/lib/screenShare);
 *  • звук публикуем, только если сервер разрешает (при мьюте от хоста его нет),
 *    и показ при этом всё равно идёт — у LiveKit отказ звука ронял весь показ;
 *  • закрытое окно выбора не превращается в MediaDevicesError комнаты (из-за
 *    него раньше мигала тревога «нет доступа к микрофону», аудит F-С4).
 * Конец показа — по факту: событие LocalTrackUnpublished с остановленной
 * дорожкой. Так одинаково ловятся кнопка дока, «Прекратить доступ» в панели
 * браузера и запрет от хоста (аудит C-13); звук «показ остановлен» — там же.
 */
export function ScreenShareProvider({ children }: { children: ReactNode }) {
  const room = useRoomContext();
  const [chosen] = usePersistentState(screenQualityPref);
  // Потолок администрации (А3): профиль выше него не включаем, выбор человека не трогаем.
  const { maxScreenQuality } = useRoomConfig();
  const quality = clampScreenQuality(chosen, maxScreenQuality);
  const perms = useMyPermissions();
  const permsRef = useLatestRef(perms);
  const qualityRef = useLatestRef(quality);
  const supported = useSyncExternalStore(noSubscribe, screenShareSupported, () => false);

  // Идущий показ — в ref (его читают обработчики событий LiveKit), а для
  // отрисовки — только факт «показ идёт».
  const activeRef = useRef<ActiveShare | null>(null);
  const [sharing, setSharing] = useState(false);
  const pendingRef = useRef(false);
  const [pending, setPendingState] = useState(false);
  const [capture, setCapture] = useState<CaptureInfo | null>(null);
  const [restartReason, setRestartReason] = useState<RestartReason | null>(null);

  const setPending = useCallback((v: boolean) => {
    pendingRef.current = v;
    setPendingState(v);
  }, []);

  /** Показ закончился (любым путём): убрать звук экрана, сбросить состояние. */
  const finish = useCallback(
    (cur: ActiveShare) => {
      if (activeRef.current !== cur) return;
      activeRef.current = null;
      setSharing(false);
      setCapture(null);
      setRestartReason(null);
      if (cur.audio) void room.localParticipant.unpublishTrack(cur.audio);
      playSfx("screen-stop");
      if (!cur.stoppedByMe && !endedByBrowser.has(cur.video.mediaStreamTrack)) {
        const p = permsRef.current;
        toast({
          id: "screen-revoked",
          tone: "caution",
          icon: "screen-stop",
          title: "Хост остановил ваш показ экрана",
          description: p.canShareScreen ? undefined : (p.screenHint ?? undefined),
        });
      }
    },
    [room, permsRef],
  );

  /** Опубликовать захват. false — не вышло (дорожки уже остановлены). */
  const publishCapture = useCallback(
    async (stream: MediaStream, q: ScreenQuality): Promise<boolean> => {
      const local = room.localParticipant;
      const [videoTrack] = stream.getVideoTracks();
      const [audioTrack] = stream.getAudioTracks();
      if (!videoTrack) {
        stream.getTracks().forEach((t) => t.stop());
        return false;
      }
      videoTrack.contentHint = SCREEN_PRESETS[q].contentHint;
      videoTrack.addEventListener("ended", () => endedByBrowser.add(videoTrack), { once: true });
      const info = captureOf(videoTrack, q);
      hintStartBitrate(videoTrack, screenStartBitrateKbps(q, info.width, info.height));

      let pub: LocalTrackPublication;
      try {
        pub = await local.publishTrack(videoTrack, {
          ...screenVideoPublishOptions(q, info),
          source: Track.Source.ScreenShare,
        });
      } catch {
        stream.getTracks().forEach((t) => t.stop());
        const p = permsRef.current;
        toast({
          id: "screen-error",
          tone: "alert",
          title: "Показ экрана не начался",
          description: p.canShareScreen
            ? "Не получилось отправить картинку. Попробуйте ещё раз."
            : (p.screenHint ?? "Хост запретил показ экрана"),
        });
        return false;
      }
      const video = pub.videoTrack;
      // Показ успели закрыть, пока шла публикация, — дальше делать нечего.
      if (!video || videoTrack.readyState === "ended") {
        audioTrack?.stop();
        if (video) void local.unpublishTrack(video);
        return false;
      }
      const share: ActiveShare = { video, audio: null, capture: info, capturedWith: q, quality: q, stoppedByMe: false };
      activeRef.current = share;
      setSharing(true);
      setCapture(info);
      setRestartReason(null);

      if (audioTrack) {
        if (permsRef.current.canShareScreenAudio) {
          try {
            const audioPub = await local.publishTrack(audioTrack, {
              ...SCREEN_AUDIO_PUBLISH,
              source: Track.Source.ScreenShareAudio,
            });
            // Показ успел закончиться, пока публиковали звук, — звук не оставляем.
            if (activeRef.current === share) share.audio = audioPub.audioTrack ?? null;
            else if (audioPub.track) void local.unpublishTrack(audioPub.track);
          } catch {
            audioTrack.stop();
          }
        } else {
          audioTrack.stop();
          toast({
            id: "screen-audio",
            icon: "volume-off",
            title: "Показ идёт без звука",
            description: "Хост выключил вам микрофон, а вместе с ним и звук показа.",
          });
        }
      }
      return true;
    },
    [room, permsRef],
  );

  const start = useCallback(async () => {
    if (pendingRef.current || activeRef.current) return;
    if (!supported || !permsRef.current.canShareScreen) return;
    setPending(true);
    try {
      const q = qualityRef.current;
      const stream = await captureScreen(q);
      if (stream && (await publishCapture(stream, q))) playSfx("screen-start");
    } finally {
      setPending(false);
    }
  }, [supported, permsRef, qualityRef, publishCapture, setPending]);

  const stop = useCallback(async () => {
    const cur = activeRef.current;
    if (!cur || pendingRef.current) return;
    cur.stoppedByMe = true;
    setPending(true);
    try {
      // Конец показа обработает слушатель LocalTrackUnpublished — тот же путь,
      // что у «Прекратить доступ» в панели браузера.
      await room.localParticipant.unpublishTrack(cur.video);
    } finally {
      setPending(false);
    }
    // Публикации уже не было (обрыв связи) — события не будет, закрываем сами.
    if (activeRef.current === cur) {
      cur.video.mediaStreamTrack.stop();
      finish(cur);
    }
  }, [room, finish, setPending]);

  const restart = useCallback(async () => {
    const cur = activeRef.current;
    if (!cur || pendingRef.current) return;
    setPending(true);
    try {
      const q = qualityRef.current;
      const stream = await captureScreen(q);
      if (!stream) return; // закрыли окно — старый показ идёт дальше
      // Старый показ снимаем молча: для друзей это та же трансляция.
      activeRef.current = null;
      await room.localParticipant.unpublishTrack(cur.video);
      if (cur.audio) await room.localParticipant.unpublishTrack(cur.audio);
      if (!(await publishCapture(stream, q))) {
        setSharing(false);
        setCapture(null);
        playSfx("screen-stop");
      }
    } finally {
      setPending(false);
    }
  }, [room, qualityRef, publishCapture, setPending]);

  const toggle = useCallback(() => {
    if (activeRef.current) void stop();
    else void start();
  }, [start, stop]);

  // Конец показа по факту: дорожку сняли и остановили. Переподключение
  // переопубликует ту же дорожку, не останавливая её, — это не конец показа.
  useEffect(() => {
    const local = room.localParticipant;
    const onUnpublished = (pub: LocalTrackPublication) => {
      const cur = activeRef.current;
      if (!cur) return;
      if (pub.source === Track.Source.ScreenShareAudio && pub.track === cur.audio) {
        // Звук сняли отдельно (хост заглушил) — картинка идёт дальше.
        if (cur.audio.mediaStreamTrack.readyState === "ended") cur.audio = null;
        return;
      }
      if (pub.source !== Track.Source.ScreenShare || pub.track !== cur.video) return;
      if (cur.video.mediaStreamTrack.readyState !== "ended") return;
      finish(cur);
    };
    local.on(ParticipantEvent.LocalTrackUnpublished, onUnpublished);
    return () => {
      local.off(ParticipantEvent.LocalTrackUnpublished, onUnpublished);
    };
  }, [room, finish]);

  // Смена профиля во время показа — на лету, без окна выбора (аудит C-7): всё
  // делает кодировщик (liveSwitch), захват не трогаем. Если профиль раскрылся
  // не целиком — советуем перезапуск.
  useEffect(() => {
    const cur = activeRef.current;
    if (!cur || cur.quality === quality) return;
    cur.quality = quality;
    cur.video.mediaStreamTrack.contentHint = SCREEN_PRESETS[quality].contentHint;
    const sender = cur.video.sender;
    if (!sender) return;
    void (async () => {
      let ok = true;
      const params = sender.getParameters();
      const plan = liveSwitch(params.encodings, cur.capture, cur.capturedWith, quality);
      try {
        params.encodings = plan.encodings;
        await sender.setParameters(params);
        await cur.video.setDegradationPreference(screenDegradation(quality));
      } catch {
        ok = false;
      }
      if (activeRef.current !== cur) return; // показ успел закончиться
      setCapture(plan.effective);
      setRestartReason(ok ? plan.restart : "failed");
    })();
  }, [quality]);

  // Уход из комнаты: остановить захват, чтобы погас значок записи экрана.
  useEffect(
    () => () => {
      const cur = activeRef.current;
      if (!cur) return;
      activeRef.current = null;
      cur.video.mediaStreamTrack.stop();
      cur.audio?.mediaStreamTrack.stop();
    },
    [],
  );

  const allowed = supported && perms.canShareScreen;
  // Нет getDisplayMedia — почти всегда телефон или планшет.
  const blockedReason = !supported
    ? "С телефона показать экран нельзя. Откройте комнату на компьютере"
    : perms.canShareScreen
      ? null
      : (perms.screenHint ?? "Подключаемся…");

  const value = useMemo<ScreenShareControl>(
    () => ({
      enabled: sharing,
      pending,
      allowed,
      blockedReason,
      capture,
      restartAdvised: restartReason !== null,
      restartHint: restartReason && RESTART_HINT[restartReason],
      toggle,
      stop: () => void stop(),
      restart: () => void restart(),
    }),
    [sharing, pending, allowed, blockedReason, capture, restartReason, toggle, stop, restart],
  );
  return <ScreenShareContext value={value}>{children}</ScreenShareContext>;
}

export function useScreenShareControl(): ScreenShareControl {
  const value = use(ScreenShareContext);
  if (!value) throw new Error("useScreenShareControl: нет ScreenShareProvider выше по дереву");
  return value;
}

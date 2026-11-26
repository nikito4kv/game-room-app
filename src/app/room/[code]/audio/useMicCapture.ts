"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RoomEvent,
  TrackEvent,
  type AudioCaptureOptions,
  type LocalAudioTrack,
  type Room,
} from "livekit-client";
import { toast } from "@/components/ui";
import { knownDevices, listDevices } from "@/lib/audio/deviceList";
import {
  DEFAULT_DEVICE,
  defaultDeviceSignature,
  deviceLabel,
  findDefaultDevice,
  isDeviceAvailable,
  type DeviceInfo,
} from "@/lib/audio/devices";
import { toMicError, type MicError } from "@/lib/audio/micErrors";
import {
  captureMatches,
  micRestartOptions,
  type CaptureSettings,
} from "@/lib/audio/voiceOptions";
import { useLatestRef } from "../state/useLatestRef";
import { usePersistentState } from "../state/usePersistentState";
import { getMicTrack } from "./micTrack";
import { captureSettingsPref, inputDevicePref } from "./voicePrefs";

/**
 * Параметры будущих публикаций (вернули микрофон после хоста) и выбор
 * устройства в LiveKit: его собственная реакция на подключение устройств
 * смотрит на activeDeviceMap. Комната — внешний объект LiveKit, её опции
 * меняются только здесь.
 */
function rememberCapture(room: Room, options: AudioCaptureOptions, deviceId: string): void {
  room.options.audioCaptureDefaults = { ...room.options.audioCaptureDefaults, ...options };
  room.localParticipant.activeDeviceMap.set("audioinput", deviceId);
}

/** Захват своего микрофона — устройство и обработка браузера. */
export type MicCapture = {
  /** Выбор человека: «default» (как в системе) или deviceId. */
  inputChoice: string;
  /** Выбранный микрофон пропал — сейчас работает системный (вернётся сам, когда подключат). */
  inputFallback: boolean;
  /**
   * Сменить микрофон. Ждёт, пока он откроется; не открылся — возвращает прежний
   * и бросает MicError. Сохраняется только удачный выбор (аудит 1-audio, 3.1).
   */
  setInputDevice: (deviceId: string) => Promise<void>;
  capture: CaptureSettings;
  /** Эхоподавление и автогромкость браузера: применяются перезапуском дорожки. */
  setCapture: (patch: Partial<CaptureSettings>) => void;
  /** Открыть микрофон заново с текущими настройками. false — трека нет (нужна публикация). */
  recapture: () => Promise<boolean>;
};

/**
 * Захват своего микрофона. Всё, что меняет сам захват, идёт перезапуском дорожки
 * (track.restartTrack): обработка MicProcessor при этом живёт дальше, LiveKit
 * отдаёт ей новый источник, а друзья слышат лишь короткую паузу.
 *
 *  • Устройство — всегда точно (micDeviceConstraint): мягкую просьбу Chrome
 *    отдаёт своему «любимому» микрофону, и после любого перезапуска вместо
 *    выбранного говорил бы он. Список устройств берём свежий на каждый перезапуск.
 *  • Обработка браузера (эхо, автогромкость, браузерный шумодав) задаётся
 *    целиком при каждом перезапуске: перезапуск LiveKit со своими параметрами
 *    (например, после отключённого микрофона) взял бы дефолты браузера — со всей
 *    его обработкой и с любым микрофоном. Такой перезапуск мы замечаем и
 *    возвращаем свои параметры.
 *  • Горячее подключение: выбранный микрофон выдернули — переходим на системный
 *    (тост), вставили обратно — возвращаемся; выбран «как в системе», а Windows
 *    сменила устройство по умолчанию — переезжаем на новое: Chrome сам живую
 *    дорожку не переносит (аудит 1-audio, 3.8).
 *  • Параметры для будущих публикаций (вернули микрофон после хоста) лежат в
 *    room.options.audioCaptureDefaults — держим их актуальными.
 */
export function useMicCapture({
  room,
  track,
  ourNoiseSuppression,
  onError,
  onDevicesChanged,
}: {
  room: Room;
  track: LocalAudioTrack | undefined;
  /** Наш шумодав работает — браузерный выключаем. */
  ourNoiseSuppression: boolean;
  /** Микрофон не открылся (вас не слышно) — для баннера. */
  onError: (error: MicError) => void;
  /** Список устройств изменился — MicProvider пробует снова, если была ошибка. */
  onDevicesChanged: (devices: DeviceInfo[]) => void;
}): MicCapture {
  const [choice] = usePersistentState(inputDevicePref);
  const [capture] = usePersistentState(captureSettingsPref);
  const [fallback, setFallback] = useState(false);
  // Список устройств — для параметров будущих публикаций; перезапуски берут свежий.
  const [devices, setDevices] = useState<DeviceInfo[]>(knownDevices);
  const activeChoice = fallback ? DEFAULT_DEVICE : choice;

  const desiredRef = useLatestRef({ choice: activeChoice, capture, ours: ourNoiseSuppression });
  const onErrorRef = useLatestRef(onError);
  const onDevicesChangedRef = useLatestRef(onDevicesChanged);
  const fallbackRef = useLatestRef(fallback);

  // Перезапуски дорожки — строго по одному: иначе быстрые переключения
  // перезапускали бы её параллельно с непредсказуемым итогом.
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const run = useCallback(<T,>(job: () => Promise<T>): Promise<T> => {
    const next = queueRef.current.then(job, job);
    queueRef.current = next.catch(() => {});
    return next;
  }, []);

  // Свои перезапуски помечаем: их событие Restarted — не повод проверять дорожку
  // заново (новый выбор человека к этому моменту может быть ещё не сохранён, и
  // проверка вернула бы прежний микрофон).
  const ownRestartsRef = useRef(0);
  const restartOwn = useCallback(async (t: LocalAudioTrack, opts: AudioCaptureOptions) => {
    ownRestartsRef.current += 1;
    try {
      await t.restartTrack(opts);
    } finally {
      ownRestartsRef.current -= 1;
    }
  }, []);

  useEffect(() => {
    rememberCapture(room, micRestartOptions(activeChoice, capture, ourNoiseSuppression, devices), activeChoice);
  }, [room, activeChoice, capture, ourNoiseSuppression, devices]);

  // Текущая дорожка — с нашей обработкой и на нашем микрофоне. Проверяем при
  // появлении дорожки, смене обработки и после чужого перезапуска (LiveKit сам
  // переоткрыл выдернутый микрофон — мягко, то есть тем, который любит браузер).
  useEffect(() => {
    if (!track) return;
    const ensure = () => {
      run(async () => {
        const d = desiredRef.current;
        const opts = micRestartOptions(d.choice, d.capture, d.ours, await listDevices());
        if (!captureMatches(track.constraints, opts)) await restartOwn(track, opts);
      }).catch((e: unknown) => onErrorRef.current(toMicError(e)));
    };
    const onRestarted = () => {
      if (ownRestartsRef.current === 0) ensure();
    };
    ensure();
    track.on(TrackEvent.Restarted, onRestarted);
    return () => {
      track.off(TrackEvent.Restarted, onRestarted);
    };
  }, [track, capture, ourNoiseSuppression, run, restartOwn, desiredRef, onErrorRef]);

  const restartTo = useCallback(
    (deviceId: string) => {
      const t = getMicTrack(room.localParticipant);
      if (!t) return;
      const d = desiredRef.current;
      run(async () => restartOwn(t, micRestartOptions(deviceId, d.capture, d.ours, await listDevices()))).catch(
        (e: unknown) => onErrorRef.current(toMicError(e)),
      );
    },
    [room, run, restartOwn, desiredRef, onErrorRef],
  );

  // Горячее подключение устройств.
  useEffect(() => {
    let alive = true;
    let lastSignature: string | null = null;
    const check = async (initial: boolean) => {
      const devices = await listDevices();
      if (!alive) return;
      // Без разрешения на микрофон браузер прячет устройства (пустые deviceId) —
      // тогда о пропаже судить нельзя.
      if (!devices.some((d) => d.kind === "audioinput" && d.deviceId)) return;
      setDevices(devices);
      const chosen = inputDevicePref.get();
      const signature = defaultDeviceSignature(devices, "audioinput");
      const systemName = deviceLabel(findDefaultDevice(devices, "audioinput"), "системный микрофон");
      const chosenHere = chosen === DEFAULT_DEVICE || isDeviceAvailable(chosen, devices, "audioinput");
      if (!chosenHere && !fallbackRef.current) {
        // Выбранного микрофона нет: при входе захват уже взял системный (его нет
        // в списке, которым собраны опции комнаты), на ходу — переключаем.
        setFallback(true);
        if (!initial) restartTo(DEFAULT_DEVICE);
        toast({
          id: "mic-device",
          tone: "caution",
          icon: "mic",
          title: initial ? "Сохранённый микрофон не найден" : "Микрофон отключён",
          description: `Говорите в «${systemName}»`,
        });
      } else if (chosenHere && fallbackRef.current) {
        // Выбранный микрофон вернулся.
        setFallback(false);
        restartTo(chosen);
        const back = devices.find((d) => d.deviceId === chosen);
        toast({ id: "mic-device", icon: "mic", title: "Микрофон снова подключён", description: deviceLabel(back, "") });
      } else if (
        !initial &&
        (chosen === DEFAULT_DEVICE || fallbackRef.current) &&
        lastSignature !== null &&
        signature !== lastSignature
      ) {
        // «Как в системе», а Windows сменила устройство по умолчанию.
        restartTo(DEFAULT_DEVICE);
        toast({ id: "mic-device", icon: "mic", title: "Микрофон сменился", description: `Теперь «${systemName}» — так выбрано в системе` });
      }
      lastSignature = signature;
      if (!initial) onDevicesChangedRef.current(devices);
    };
    void check(true);
    const onChange = () => void check(false);
    room.on(RoomEvent.MediaDevicesChanged, onChange);
    return () => {
      alive = false;
      room.off(RoomEvent.MediaDevicesChanged, onChange);
    };
  }, [room, restartTo, fallbackRef, onDevicesChangedRef]);

  const setInputDevice = useCallback(
    async (deviceId: string) => {
      const t = getMicTrack(room.localParticipant);
      const d = desiredRef.current;
      if (t) {
        try {
          await run(async () => restartOwn(t, micRestartOptions(deviceId, d.capture, d.ours, await listDevices(), true)));
        } catch (e) {
          // Не открылся — возвращаем прежний, чтобы микрофон не остался мёртвым.
          await run(async () =>
            restartOwn(t, micRestartOptions(d.choice, d.capture, d.ours, await listDevices())),
          ).catch((e2: unknown) => onErrorRef.current(toMicError(e2)));
          throw toMicError(e);
        }
      }
      setFallback(false);
      inputDevicePref.set(deviceId);
    },
    [room, run, restartOwn, desiredRef, onErrorRef],
  );

  const setCapture = useCallback((patch: Partial<CaptureSettings>) => {
    captureSettingsPref.set((prev) => ({ ...prev, ...patch }));
  }, []);

  const recapture = useCallback(async () => {
    const t = getMicTrack(room.localParticipant);
    if (!t) return false;
    const d = desiredRef.current;
    await run(async () => restartOwn(t, micRestartOptions(d.choice, d.capture, d.ours, await listDevices())));
    return true;
  }, [room, run, restartOwn, desiredRef]);

  return useMemo(
    () => ({ inputChoice: choice, inputFallback: fallback, setInputDevice, capture, setCapture, recapture }),
    [choice, fallback, setInputDevice, capture, setCapture, recapture],
  );
}

"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getInputDevice, getOutputDevice, setInputDevice, setOutputDevice } from "@/lib/clientStorage";
import { listDevices } from "@/lib/audio/deviceList";
import { DEFAULT_DEVICE, deviceOptions, isDeviceAvailable, micDeviceConstraint, type DeviceInfo } from "@/lib/audio/devices";
import { toMicError, type MicError } from "@/lib/audio/micErrors";
import { startMicTest, type MicTest } from "@/lib/audio/micTest";
import { outputSelectionSupported, resumePlayback, switchOutput } from "@/lib/audio/playback";
import { playTestSound } from "@/lib/audio/sfx";

export type LobbyDevices = {
  micId: string;
  setMicId: (id: string) => void;
  micOptions: { value: string; label: string }[];
  /** Уровень микрофона, дБFS — для LevelMeter (опрос в его rAF, без перерисовок React). */
  getLevelDb: () => number;
  /** Микрофон не открылся: нет доступа, не найден, занят. Войти и слушать всё равно можно. */
  micError: MicError | null;
  /** Ещё раз открыть микрофон (после разрешения в адресной строке). */
  retryMic: () => void;
  /** Браузер умеет выбирать вывод (Chrome/Edge); в Firefox звук идёт в системный. */
  outputSupported: boolean;
  outId: string;
  setOutId: (id: string) => void;
  outOptions: { value: string; label: string }[];
  /** Вывод не переключился — подсказка под списком. */
  outError: string | null;
  /** «Проверить»: короткий звук в выбранный вывод. Звать из клика (жест). */
  testOutput: () => void;
  /** Что с проверкой звука — для отклика на кнопке и подсказки «Не слышно?». */
  outputTest: OutputTest;
  /** Запомнить выбор теми же ключами, что и настройки комнаты. */
  save: () => void;
};

/** idle — не проверяли; playing — звук идёт («Играет…»); played — доиграл. */
export type OutputTest = "idle" | "playing" | "played";

/**
 * Сколько держать «Играет…». Сам звук короче (~0,3 с), но такой отклик
 * мелькнул бы незаметно — а человеку важно увидеть, что кнопка сработала.
 */
const TEST_FEEDBACK_MS = 1200;

const noSubscribe = () => () => {};
const readSavedMic = () => getInputDevice() || DEFAULT_DEVICE;
const readSavedOut = () => getOutputDevice() || DEFAULT_DEVICE;
const serverDefault = () => DEFAULT_DEVICE;

/**
 * Устройства в лобби: выбор микрофона с живой полосой уровня и выбор вывода с
 * «Проверить». Микрофон открывается сразу (браузер спросит разрешение прямо в
 * лобби), полоса оживает с первым нажатием на странице — без жеста звук спит.
 * Поток освобождается при уходе из лобби.
 */
export function useLobbyDevices(): LobbyDevices {
  // Сохранённое читаем через внешнее хранилище: на сервере и при гидратации — «как в системе».
  const savedMic = useSyncExternalStore(noSubscribe, readSavedMic, serverDefault);
  const savedOut = useSyncExternalStore(noSubscribe, readSavedOut, serverDefault);
  const outputSupported = useSyncExternalStore(noSubscribe, outputSelectionSupported, () => false);
  const [chosenMic, setChosenMic] = useState<string | null>(null);
  const [chosenOut, setChosenOut] = useState<string | null>(null);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [micError, setMicError] = useState<MicError | null>(null);
  const [outError, setOutError] = useState<string | null>(null);
  const [micTick, setMicTick] = useState(0);
  // Номер нажатия «Проверить» и какое из них уже доиграло (0 — не нажимали).
  const [testRun, setTestRun] = useState(0);
  const [playedRun, setPlayedRun] = useState(0);
  const testRef = useRef<MicTest | null>(null);
  // Для какого выбора проверку уже переоткрывали после первого разрешения (см. ниже).
  const reopenedForRef = useRef<string | null>(null);

  const refreshDevices = useCallback(
    () =>
      listDevices().then((list) => {
        setDevices(list);
        return list;
      }),
    [],
  );

  useEffect(() => {
    const onChange = () => void refreshDevices();
    onChange();
    navigator.mediaDevices?.addEventListener("devicechange", onChange);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", onChange);
  }, [refreshDevices]);

  // Пропавшее устройство (выдернули гарнитуру) — показываем «как в системе».
  const pickMic = chosenMic ?? savedMic;
  const micId =
    devices.length === 0 || isDeviceAvailable(pickMic, devices, "audioinput") ? pickMic : DEFAULT_DEVICE;
  const pickOut = chosenOut ?? savedOut;
  const outId =
    devices.length === 0 || isDeviceAvailable(pickOut, devices, "audiooutput") ? pickOut : DEFAULT_DEVICE;

  // Проверка микрофона — сырой поток без нашей обработки: лобби должно открываться быстро.
  useEffect(() => {
    let cancelled = false;
    startMicTest(micId, 1, { processing: false }).then(
      (test) => {
        if (cancelled) {
          void test.stop();
          return;
        }
        testRef.current = test;
        setMicError(null);
        // С разрешением у устройств появились названия. Если это было первое
        // разрешение, до него браузер списка не показывал и микрофон открылся
        // без точного устройства — Chrome мог взять своё «любимое», а не
        // выбранное. Теперь список известен: переоткрываем один раз, точно.
        void refreshDevices().then((list) => {
          const want = micDeviceConstraint(micId, list, true);
          const exact = typeof want === "object" && !Array.isArray(want) ? want.exact : undefined;
          if (cancelled || typeof exact !== "string" || test.source?.deviceId === exact) return;
          if (reopenedForRef.current === micId) return;
          reopenedForRef.current = micId;
          setMicTick((n) => n + 1);
        });
      },
      (err: unknown) => {
        if (!cancelled) setMicError(toMicError(err));
      },
    );
    return () => {
      cancelled = true;
      const test = testRef.current;
      testRef.current = null;
      void test?.stop();
    };
  }, [micId, micTick, refreshDevices]);

  const getLevelDb = useCallback(() => testRef.current?.levelDb() ?? -Infinity, []);

  const setOutId = useCallback((id: string) => {
    setChosenOut(id);
    setOutError(null);
    // Другое устройство — прошлая проверка о нём ничего не говорит.
    setTestRun(0);
    setPlayedRun(0);
    switchOutput(id).catch(() => {
      setChosenOut(null);
      setOutError("Это устройство сейчас недоступно. Звук остался на прежнем.");
    });
  }, []);

  const testOutput = useCallback(() => {
    setTestRun((n) => n + 1);
    void resumePlayback().then(() => playTestSound());
  }, []);

  // «Играет…» держится немного дольше самого звука, потом — «доиграл».
  useEffect(() => {
    if (testRun === 0) return;
    const timer = window.setTimeout(() => setPlayedRun(testRun), TEST_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [testRun]);
  const outputTest: OutputTest = testRun === 0 ? "idle" : playedRun === testRun ? "played" : "playing";

  const save = useCallback(() => {
    setInputDevice(micId);
    if (outputSupported) setOutputDevice(outId);
  }, [micId, outId, outputSupported]);

  return {
    micId,
    setMicId: setChosenMic,
    micOptions: deviceOptions(devices, "audioinput", "Микрофон"),
    getLevelDb,
    micError,
    retryMic: () => setMicTick((n) => n + 1),
    outputSupported,
    outId,
    setOutId,
    outOptions: deviceOptions(devices, "audiooutput", "Динамики"),
    outError,
    testOutput,
    outputTest,
    save,
  };
}

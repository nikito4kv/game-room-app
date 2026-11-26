import type { AudioCaptureOptions, TrackPublishDefaults } from "livekit-client";
import { DEFAULT_DEVICE, micDeviceConstraint, type DeviceInfo } from "./devices";

/**
 * Параметры захвата и публикации голоса. Единое место: из него собираются
 * audioCaptureDefaults и publishDefaults комнаты (см. buildRoomOptions в
 * @/lib/roomOptions) и захват в «Проверке микрофона» (micTest.ts).
 */

export type MicCaptureOptions = {
  /**
   * Наш шумодав (RNNoise в MicProcessor) активен. Тогда браузерный шумодав и
   * «изоляцию голоса» выключаем: шумодав поверх шумодава даёт «подводный» и
   * «роботный» звук (модели учат на сыром звуке — так советуют и LiveKit, и
   * Twilio). Не загрузился наш — фаза 2 перезахватывает микрофон с false, и
   * браузерный включается обратно.
   */
  ourNoiseSuppression?: boolean;
  /** Эхоподавление — по умолчанию вкл: без наушников друзья слышали бы себя. */
  echoCancellation?: boolean;
  /**
   * Браузерная автогромкость — по умолчанию ВЫКЛ. В Chrome это AGC2: до +50 дБ
   * со скоростью 6 дБ/с, и в ваших паузах он вытягивает голоса соседей до
   * «нормальной громкости», а заодно двигает ползунок микрофона в Windows. Вместо
   * неё — своя автогромкость, которая учится только на вашем голосе.
   */
  autoGainControl?: boolean;
};

/**
 * Параметры захвата микрофона.
 *
 * channelCount: 1 — голос всегда моно. LiveKit помечает трек стерео по channelCount
 * ИСХОДНОГО микрофона (у встроенных входов Windows он часто 2), и тогда сервер
 * договаривается о стерео-Opus: вдвое больше трафика, без DTX, а любая асимметрия
 * каналов слышна как «говорит в одно ухо».
 *
 * device — какой микрофон открыть (micDeviceConstraint: только точно). Отдаём его
 * сразу в захват, а не через switchActiveDevice после подключения: LiveKitRoom
 * включает микрофон ещё на SignalConnected, и переключение гонялось с захватом —
 * то молча не применялось, то переоткрывало микрофон.
 *
 * Все флаги обработки задаём явно: LiveKit по умолчанию включает их все
 * (autoGainControl, noiseSuppression, voiceIsolation — true), а наши значения
 * перекрывают его дефолты только если указаны.
 */
export function micCaptureDefaults(
  device?: ConstrainDOMString,
  options: MicCaptureOptions = {},
): AudioCaptureOptions {
  const ours = options.ourNoiseSuppression ?? true;
  return {
    channelCount: 1,
    echoCancellation: options.echoCancellation ?? true,
    autoGainControl: options.autoGainControl ?? false,
    noiseSuppression: !ours,
    // «Изоляция голоса» — тот же шумодав, только системный (на Windows Chrome его
    // нет, есть на части ChromeOS и в Safari): держим в паре с браузерным.
    voiceIsolation: !ours,
    ...(device ? { deviceId: device } : {}),
  };
}

/**
 * Обработка захвата, которую выбирает человек (настройки → «Обработка»). Наш
 * шумодав сюда не входит: включён ли браузерный, решает состояние нашего (см.
 * audio/useMicPipeline).
 */
export type CaptureSettings = {
  /** Эхоподавление браузера: нужно, когда звук идёт из колонок, а не из наушников. */
  echoCancellation: boolean;
  /** Автогромкость браузера: выравнивает громкость, но в паузах вытягивает голоса соседей. */
  autoGainControl: boolean;
};

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  echoCancellation: true,
  autoGainControl: false,
};

/** Сохранённые настройки захвата → допустимые (мусор → по умолчанию). */
export function sanitizeCaptureSettings(raw: unknown): CaptureSettings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    echoCancellation:
      typeof r.echoCancellation === "boolean" ? r.echoCancellation : DEFAULT_CAPTURE_SETTINGS.echoCancellation,
    autoGainControl:
      typeof r.autoGainControl === "boolean" ? r.autoGainControl : DEFAULT_CAPTURE_SETTINGS.autoGainControl,
  };
}

/**
 * Ограничения для перезапуска дорожки (track.restartTrack): выбранное устройство
 * и вся обработка разом. Перезапуск без них взял бы дефолты браузера — со всей
 * его обработкой и стерео — и микрофон, который браузер любит сам. devices —
 * текущий список (см. micDeviceConstraint); strict — человек только что выбрал
 * микрофон сам и должен узнать, что он не открылся.
 */
export function micRestartOptions(
  deviceId: string,
  capture: CaptureSettings,
  ourNoiseSuppression: boolean,
  devices: DeviceInfo[],
  strict = false,
): AudioCaptureOptions {
  return micCaptureDefaults(micDeviceConstraint(deviceId, devices, strict), { ourNoiseSuppression, ...capture });
}

/**
 * Ограничение устройства одной строкой: «exact:id», «ideal:id» или "" — устройство
 * выбирает браузер. «default» без exact — тоже "": так LiveKit сам дописывает
 * ограничения без устройства ({ ideal: "default" }).
 */
function deviceKey(c: ConstrainDOMString | undefined): string {
  if (c === undefined) return "";
  if (typeof c === "string" || Array.isArray(c)) return c === DEFAULT_DEVICE ? "" : `ideal:${String(c)}`;
  if (c.exact !== undefined) return `exact:${String(c.exact)}`;
  if (c.ideal !== undefined && c.ideal !== DEFAULT_DEVICE) return `ideal:${String(c.ideal)}`;
  return "";
}

/**
 * Захвачена ли дорожка уже так, как нужно (по её текущим ограничениям в
 * LiveKit), — тогда перезапуск не нужен: те же флаги обработки, число каналов и,
 * если микрофон просим точно, то же точное устройство. Дорожку, открытую мягко
 * (вход до того, как стал известен список устройств, перезапуск самого LiveKit),
 * перезапускаем точно. Без точного устройства (Firefox, Safari) подходит любое.
 */
export function captureMatches(current: MediaTrackConstraints, desired: AudioCaptureOptions): boolean {
  const device = deviceKey(desired.deviceId);
  return (
    current.channelCount === desired.channelCount &&
    current.echoCancellation === desired.echoCancellation &&
    current.autoGainControl === desired.autoGainControl &&
    current.noiseSuppression === desired.noiseSuppression &&
    (device === "" || deviceKey(current.deviceId) === device)
  );
}

/**
 * Те же параметры для прямого getUserMedia (проверка микрофона в лобби и в
 * настройках). Выбранное устройство — точно, даже если его нет в списке: тест
 * должен слушать именно его. devices — текущий список (см. micDeviceConstraint).
 */
export function micTestConstraints(
  deviceId?: string | null,
  options: MicCaptureOptions = {},
  devices: DeviceInfo[] = [],
): MediaTrackConstraints & { voiceIsolation?: ConstrainBoolean } {
  const c = micCaptureDefaults(micDeviceConstraint(deviceId, devices, true), options);
  return {
    channelCount: c.channelCount,
    echoCancellation: c.echoCancellation,
    autoGainControl: c.autoGainControl,
    noiseSuppression: c.noiseSuppression,
    voiceIsolation: c.voiceIsolation,
    ...(c.deviceId ? { deviceId: c.deviceId } : {}),
  };
}

/**
 * Публикация голоса: Opus моно ~64 кбит/с — с запасом прозрачно для речи
 * (дефолт LiveKit — 48), DTX (в паузах почти нет трафика — порог даёт честную
 * тишину) и RED (дубли пакетов спасают от потерь на клубном Wi-Fi). Приоритет
 * high — при нехватке канала голос важнее демонстрации экрана.
 */
export const VOICE_PUBLISH_DEFAULTS = {
  audioPreset: { maxBitrate: 64_000, priority: "high" },
  dtx: true,
  red: true,
  forceStereo: false,
} as const satisfies TrackPublishDefaults;

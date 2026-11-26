// Демонстрация экрана: профили качества, захват, публикация, права и кодек.
// Единое место для чисел — чтобы UI комнаты оставался тонким, а значения профиля
// не разъезжались между захватом, отправкой и подписями в настройках.
//
// Как устроено (аудит C-1…C-14):
//  • Захват делаем сами (getDisplayMedia), а не через setScreenShareEnabled:
//    LiveKit пропускает в браузер только известные ему поля и одинаковые опции
//    публикации отдаёт и картинке, и звуку. Нам нужно разное: звук экрана —
//    стерео 128 кбит/с без DTX/RED, голосовые настройки (publishDefaults) ему
//    не подходят.
//  • Верхний слой — во всё качество профиля, нижний — дешёвый 360p 15 к/с
//    ~0,4 Мбит/с (почти бесплатно для кодировщика). Зрители с большой сценой
//    берут верхний (adaptiveStream с pixelDensity: 2 в roomOptions), нижний —
//    запас при перегрузке канала и второй показ, пока его не смотрят крупно.
//    Профилю «Текст» нижний слой не нужен: мелкий текст в 360p не прочитать.
//  • Кодек — H.264 только в Chromium на Windows (видеокарта кодирует, игре не
//    мешает), иначе VP8. VP9/AV1 для экрана не берём: программное кодирование
//    1080p60 бьёт по FPS игры, а LiveKit для показа экрана в SVC-кодеках ещё и
//    принудительно ставит contentHint = motion, что ломает профиль «Текст».
//
// Без value-импортов из livekit-client: модуль тянет clientStorage, а он есть
// на каждой странице — библиотека звонков туда попадать не должна.

import type { TrackPublishOptions, VideoPreset } from "livekit-client";

/** Профиль качества демонстрации. Выбирает стример в настройках. */
export type ScreenQuality = "light" | "smooth" | "max" | "text";

type ScreenPreset = {
  /** Название профиля: «Игры». */
  title: string;
  /** Техническая строка: «1080p · 60 к/с». */
  meta: string;
  /**
   * Пояснение без вранья: сколько отдачи нужно у стримера. Через сервер
   * (SFU) поток уходит один раз, от числа зрителей отдача не растёт (аудит C-8).
   */
  description: string;
  /** Потолок захвата: больше браузер не пришлёт, меньший экран останется как есть. */
  width: number;
  height: number;
  frameRate: number;
  /** Потолок битрейта верхнего слоя, бит/с (для экрана меньше профиля — меньше). */
  maxBitrate: number;
  /** motion — игра, держим плавность; text — код и документы, держим резкость. */
  contentHint: "motion" | "text";
  /** Публиковать ли дешёвый нижний слой. */
  simulcast: boolean;
};

export const SCREEN_PRESETS: Record<ScreenQuality, ScreenPreset> = {
  light: {
    title: "Лёгкий",
    meta: "720p · 60 к/с",
    description: "Слабый интернет или ноутбук. Нужно ~3,5 Мбит/с отдачи.",
    width: 1280,
    height: 720,
    frameRate: 60,
    maxBitrate: 3_500_000,
    contentHint: "motion",
    simulcast: true,
  },
  smooth: {
    title: "Игры",
    meta: "1080p · 60 к/с",
    description: "Плавно и чётко. Нужно ~6 Мбит/с отдачи.",
    width: 1920,
    height: 1080,
    frameRate: 60,
    maxBitrate: 6_000_000,
    contentHint: "motion",
    simulcast: true,
  },
  max: {
    title: "Максимум",
    meta: "1440p · 60 к/с",
    description:
      "Мощный ПК и быстрый интернет: нужно ~8 Мбит/с отдачи. На мониторе 1080p будет 1080p. Включайте, когда показывает кто-то один.",
    width: 2560,
    height: 1440,
    frameRate: 60,
    maxBitrate: 8_000_000,
    contentHint: "motion",
    simulcast: true,
  },
  text: {
    title: "Текст",
    meta: "до 1440p · 15 к/с",
    description: "Код, документы, таблицы: резкость важнее плавности. Нужно до 4 Мбит/с отдачи.",
    width: 2560,
    height: 1440,
    frameRate: 15,
    maxBitrate: 4_000_000,
    contentHint: "text",
    simulcast: false,
  },
};

export const DEFAULT_SCREEN_QUALITY: ScreenQuality = "smooth";

export function isScreenQuality(v: unknown): v is ScreenQuality {
  return typeof v === "string" && Object.hasOwn(SCREEN_PRESETS, v);
}

// ── Захват ────────────────────────────────────────────────────────────────────

/**
 * Ограничения картинки: потолок размера (браузер уменьшит больший экран с
 * сохранением пропорций и не станет растягивать меньший) и частота кадров.
 */
function videoConstraints(q: ScreenQuality): MediaTrackConstraints {
  const p = SCREEN_PRESETS[q];
  return {
    width: { max: p.width },
    height: { max: p.height },
    frameRate: { ideal: p.frameRate, max: p.frameRate },
  };
}

/** Звук экрана: в TS-типах DOM ещё нет restrictOwnAudio (Chrome 141+). */
type ScreenAudioConstraints = MediaTrackConstraints & { restrictOwnAudio?: boolean };

/**
 * Звук экрана. restrictOwnAudio — системный звук без звука самой вкладки
 * комнаты: иначе друзья слышат свои голоса эхом (аудит C-3). Обработка голоса
 * выключена: шумодав и автогромкость «жуют» музыку и звук игры. Стерео — если
 * источник его даёт.
 */
const SCREEN_AUDIO_CONSTRAINTS: ScreenAudioConstraints = {
  restrictOwnAudio: true,
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: { ideal: 2 },
};

/** Опции getDisplayMedia с полями Chrome, которых ещё нет в типах DOM. */
export type DisplayCaptureOptions = DisplayMediaStreamOptions & {
  /** Не предлагать вкладку самой комнаты: показ себя же — «зеркальный коридор». */
  selfBrowserSurface?: "include" | "exclude";
  /** Кнопка «Показать эту вкладку» в панели браузера — смена вкладки без перезапуска. */
  surfaceSwitching?: "include" | "exclude";
  /** Предлагать системный звук при показе всего экрана (Windows). */
  systemAudio?: "include" | "exclude";
};

export function displayMediaOptions(q: ScreenQuality): DisplayCaptureOptions {
  return {
    video: videoConstraints(q),
    audio: SCREEN_AUDIO_CONSTRAINTS,
    selfBrowserSurface: "exclude",
    surfaceSwitching: "include",
    systemAudio: "include",
  };
}

/**
 * Что сказать, если окно выбора экрана вернуло ошибку. null — человек сам
 * закрыл окно выбора: это не ошибка, ничего не показываем. Запрет записи экрана
 * в системе (macOS) приходит тем же NotAllowedError — отличает его только текст.
 */
export function captureErrorText(e: { name?: string; message?: string }): string | null {
  switch (e.name) {
    case "NotAllowedError":
      return /system/i.test(e.message ?? "")
        ? "Разрешите браузеру запись экрана в настройках системы и попробуйте снова."
        : null;
    case "NotReadableError":
      return "Экран сейчас недоступен: его занимает другая программа, или окно закрылось.";
    case "NotFoundError":
      return "Браузер не нашёл, что показать.";
    case "OverconstrainedError":
      return "Браузер не смог захватить экран в этом качестве. Выберите профиль полегче.";
    default:
      return "Не получилось начать показ. Попробуйте ещё раз.";
  }
}

/** Браузер вообще умеет показывать экран (на телефонах — нет). */
export function screenShareSupported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

/**
 * «1920×1080, 60 к/с» — что реально захвачено (а значит, что видят друзья).
 * Пробелы неразрывные: в тесном центре стола строка переносится целиком, а не
 * «60» на одной строке и «к/с» на другой.
 */
export function describeCapture(width: number, height: number, frameRate: number): string {
  const nbsp = String.fromCharCode(160);
  return `${width}×${height},${nbsp}${Math.round(frameRate)}${nbsp}к/с`;
}

// ── Публикация ────────────────────────────────────────────────────────────────

const PX_720 = 1280 * 720;
const PX_1080 = 1920 * 1080;

/**
 * Потолок битрейта верхнего слоя под реальный размер захвата. «Максимум» на
 * мониторе 1080p даёт 1080p — тратить на него 8 Мбит/с незачем (аудит C-8).
 * Запас 10% — на окна и мониторы чуть больше ступени.
 */
export function screenBitrate(q: ScreenQuality, width: number, height: number): number {
  const p = SCREEN_PRESETS[q];
  const pixels = width > 0 && height > 0 ? width * height : p.width * p.height;
  const text = p.contentHint === "text";
  const tier =
    pixels <= PX_720 * 1.1
      ? text ? 2_000_000 : 3_500_000
      : pixels <= PX_1080 * 1.1
        ? text ? 3_000_000 : 6_000_000
        : text ? 4_000_000 : 8_000_000;
  return Math.min(p.maxBitrate, tier);
}

// ── Разгон канала ─────────────────────────────────────────────────────────────

/** Доля потолка верхнего слоя, с которой отправитель начинает оценку канала. */
const START_BITRATE_SHARE = 0.4;

/**
 * Стартовая оценка канала отправителя для показа, кбит/с (x-google-start-bitrate).
 *
 * Без неё Chrome начинает с ~350 кбит/с и прибавляет ~8 % в секунду, а верхний
 * слой включается, только когда оценка дорастёт до ~1,5 Мбит/с: на стенде
 * зритель первые 21–23 с видел 360p. С подсказкой 1080p у зрителя через 1–2 с
 * (замер фазы 3: включение верхнего слоя 21,5 → 1,1 с), а дальше оценка растёт
 * как обычно. 40 % потолка — с запасом выше порога верхнего слоя (хватало и
 * 1,5 Мбит/с) и осторожнее, чем 70 %, которые LiveKit сам ставит SVC-кодекам.
 * Отдача меньше подсказки — оценка канала сама уйдёт вниз за 1–2 с.
 */
export function screenStartBitrateKbps(q: ScreenQuality, width: number, height: number): number {
  return Math.round((screenBitrate(q, width, height) * START_BITRATE_SHARE) / 1000);
}

/** Кодеки показа, для которых Chrome читает x-google-start-bitrate. */
const START_BITRATE_CODECS = /^a=rtpmap:(\d+) (H264|VP8)\//i;

/**
 * Дописать x-google-start-bitrate кодекам H.264 и VP8 видеосекции mid. Нужна
 * правка ответа сервера: отправку Chrome настраивает по нему. Параметр уже есть —
 * не трогаем; секции с таким mid нет — SDP как был. Строки и их порядок прежние,
 * кодеку без fmtp (обычно VP8) своя строка встаёт сразу за rtpmap.
 */
export function withStartBitrate(sdp: string, mid: string, kbps: number): string {
  const eol = sdp.includes("\r\n") ? "\r\n" : "\n";
  const lines = sdp.split(eol);
  const out: string[] = [];
  let section: string[] = [];
  const flush = () => {
    out.push(...addToSection(section, mid, kbps));
    section = [];
  };
  for (const line of lines) {
    if (line.startsWith("m=")) flush();
    section.push(line);
  }
  flush();
  return out.join(eol);
}

function addToSection(section: string[], mid: string, kbps: number): string[] {
  if (!section[0]?.startsWith("m=video") || !section.includes(`a=mid:${mid}`)) return section;
  const codecs = new Set<string>();
  const withFmtp = new Set<string>();
  for (const line of section) {
    const rtp = START_BITRATE_CODECS.exec(line);
    if (rtp) codecs.add(rtp[1]);
    const fmtp = /^a=fmtp:(\d+) /.exec(line);
    if (fmtp) withFmtp.add(fmtp[1]);
  }
  const param = `x-google-start-bitrate=${kbps}`;
  return section.flatMap((line) => {
    const fmtp = /^a=fmtp:(\d+) /.exec(line);
    if (fmtp && codecs.has(fmtp[1]) && !line.includes("x-google-start-bitrate")) return [`${line};${param}`];
    const rtp = START_BITRATE_CODECS.exec(line);
    if (rtp && !withFmtp.has(rtp[1])) return [line, `a=fmtp:${rtp[1]} ${param}`];
    return [line];
  });
}

/** Нижний слой: 360p 15 к/с, ~0,4 Мбит/с. Структурно VideoPreset, без класса. */
const LOW_LAYER = { width: 640, height: 360, maxBitrate: 400_000, maxFramerate: 15 } as const;

function lowLayerPreset(): VideoPreset {
  const { width, height, maxBitrate, maxFramerate } = LOW_LAYER;
  return {
    width,
    height,
    aspectRatio: width / height,
    encoding: { maxBitrate, maxFramerate },
    resolution: { width, height, frameRate: maxFramerate, aspectRatio: width / height },
  };
}

/**
 * Чем жертвовать, когда не хватает канала или процессора: игра держит плавность
 * (кадры), текст — резкость (разрешение).
 */
export function screenDegradation(q: ScreenQuality): RTCDegradationPreference {
  return SCREEN_PRESETS[q].contentHint === "motion" ? "maintain-framerate" : "maintain-resolution";
}

/**
 * Опции публикации картинки (source добавляет вызывающий код). Кодек и
 * backupCodec — из publishDefaults комнаты (roomOptions).
 */
export function screenVideoPublishOptions(
  q: ScreenQuality,
  dims: { width: number; height: number },
): TrackPublishOptions {
  const p = SCREEN_PRESETS[q];
  return {
    simulcast: p.simulcast,
    screenShareEncoding: {
      maxBitrate: screenBitrate(q, dims.width, dims.height),
      maxFramerate: p.frameRate,
    },
    // Новый массив на каждый вызов: LiveKit сортирует слои на месте.
    screenShareSimulcastLayers: p.simulcast ? [lowLayerPreset()] : undefined,
    degradationPreference: screenDegradation(q),
  };
}

/**
 * Опции публикации звука экрана. Перекрывают голосовые publishDefaults (Opus
 * 64 кбит/с моно, DTX, RED): музыке и игре нужны стерео 128 кбит/с, а DTX и
 * RED для непрерывного звука только вредят. Приоритет ниже голоса — при
 * нехватке канала друзей должно быть слышно лучше, чем игру.
 */
export const SCREEN_AUDIO_PUBLISH: TrackPublishOptions = {
  audioPreset: { maxBitrate: 128_000, priority: "medium" },
  forceStereo: true,
  dtx: false,
  red: false,
};

/** Что реально захвачено: размер и частота кадров дорожки. */
export type CaptureSize = { width: number; height: number; frameRate: number };

export type LiveSwitch = {
  /** Новые параметры отправителя: число и порядок слоёв — как при публикации. */
  encodings: RTCRtpEncodingParameters[];
  /** Что увидят друзья после переключения. */
  effective: CaptureSize;
  /**
   * Что из профиля на лету не раскрылось — поможет перезапуск показа. frames —
   * нужно больше кадров, чем захвачено; layer — нет нижнего слоя (показ
   * начинался в «Тексте»); pixels — захват упёрся в рамку прежнего профиля, и
   * экран, возможно, крупнее. null — профиль работает целиком.
   */
  restart: "frames" | "layer" | "pixels" | null;
};

/**
 * Смена профиля во время показа — без окна выбора экрана (аудит C-7). Захват не
 * трогаем: applyConstraints у захвата экрана в Chrome ненадёжен (на стенде после
 * смены рамки кадры приходили в родном 4K, а частота не возвращалась к 60). Всё
 * делает кодировщик: верхний (последний) слой уменьшается до рамки профиля
 * (scaleResolutionDownBy), получает его кадры и битрейт; нижние — не больше
 * 15 к/с, их масштаб от захвата прежний.
 *
 * capturedWith — профиль, с которым начинали показ: если захват упёрся в его
 * рамку, экран, возможно, больше, и профиль с рамкой крупнее раскроется только
 * после перезапуска.
 */
export function liveSwitch(
  encodings: readonly RTCRtpEncodingParameters[],
  capture: CaptureSize,
  capturedWith: ScreenQuality,
  to: ScreenQuality,
): LiveSwitch {
  const p = SCREEN_PRESETS[to];
  const was = SCREEN_PRESETS[capturedWith];
  const scale = Math.max(1, capture.width / p.width, capture.height / p.height);
  const effective = {
    width: Math.round(capture.width / scale),
    height: Math.round(capture.height / scale),
    frameRate: Math.min(p.frameRate, capture.frameRate),
  };
  const top = encodings.length - 1;
  const next = encodings.map((e, i) =>
    i === top
      ? {
          ...e,
          scaleResolutionDownBy: scale,
          maxBitrate: screenBitrate(to, effective.width, effective.height),
          maxFramerate: effective.frameRate,
        }
      : { ...e, maxFramerate: Math.min(LOW_LAYER.maxFramerate, effective.frameRate) },
  );
  const capped = capture.width >= was.width || capture.height >= was.height;
  const restart =
    p.frameRate > capture.frameRate + 1
      ? "frames"
      : p.simulcast && encodings.length < 2
        ? "layer"
        : capped && (p.width > was.width || p.height > was.height)
          ? "pixels"
          : null;
  return { encodings: next, effective, restart };
}

// ── Кодек ─────────────────────────────────────────────────────────────────────

export type DetectedOS = "windows" | "macos" | "ios" | "linux" | "unknown";

/** Современный Client Hints API; в типах DOM пока неполный — читаем аккуратно. */
type UADataLike = { platform?: string; brands?: { brand: string }[] };

function uaData(): UADataLike | undefined {
  return (navigator as Navigator & { userAgentData?: UADataLike }).userAgentData;
}

/**
 * Грубое определение ОС клиента (у LiveKit кросс-ОС хелпера нет, а getBrowser()
 * помечен @internal). Приоритет — userAgentData.platform, затем userAgent.
 * На сервере (SSR, нет navigator) → "unknown".
 */
export function detectOS(): DetectedOS {
  if (typeof navigator === "undefined") return "unknown";

  const platform = uaData()?.platform?.toLowerCase();
  if (platform) {
    if (platform.includes("win")) return "windows";
    if (platform.includes("mac")) return "macos";
    if (platform.includes("linux") || platform.includes("android")) return "linux";
  }

  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/windows|win32|win64/.test(ua)) return "windows";
  if (/macintosh|mac os x/.test(ua)) return "macos";
  if (/android|linux|x11/.test(ua)) return "linux";
  return "unknown";
}

/** Chrome, Edge, Яндекс Браузер, Opera — всё на Chromium. Firefox — нет. */
export function isChromium(): boolean {
  if (typeof navigator === "undefined") return false;
  const brands = uaData()?.brands;
  if (brands?.some((b) => /chromium/i.test(b.brand))) return true;
  const ua = navigator.userAgent;
  return /Chrome\/\d/.test(ua) && !/Firefox\//.test(ua);
}

/** Реально ли браузер умеет кодировать H.264 (а не только заявляет в UA). */
function supportsH264Encode(): boolean {
  if (typeof RTCRtpSender === "undefined" || typeof RTCRtpSender.getCapabilities !== "function") {
    return false;
  }
  const caps = RTCRtpSender.getCapabilities("video");
  return !!caps?.codecs.some((c) => /video\/h264/i.test(c.mimeType));
}

/**
 * Видеокодек показа. H.264 — только Chromium на Windows: там его обычно кодирует
 * видеокарта (NVENC/QuickSync/AMF) и процессор остаётся игре. Firefox на Windows
 * тоже заявляет H.264, но кодирует программно и без simulcast (аудит C-14).
 * Остальным — VP8: надёжный программный кодек с малой задержкой.
 */
export function pickScreenShareCodec(): "h264" | "vp8" {
  if (detectOS() === "windows" && isChromium() && supportsH264Encode()) return "h264";
  return "vp8";
}

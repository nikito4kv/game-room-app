// Ошибки микрофона: какой вид у ошибки getUserMedia и что сказать человеку.
// Раньше любая ошибка выглядела как «нет доступа» (аудит 1-audio, 3.15), хотя
// на Windows чаще всего микрофон просто занят другой программой.

/** Вид ошибки микрофона — по нему баннер выбирает текст и действие. */
export type MicErrorKind = "denied" | "not-found" | "busy" | "constraints" | "unknown";

/** Ошибка микрофона для интерфейса: вид + готовые тексты. */
export type MicError = {
  kind: MicErrorKind;
  /** Заголовок баннера: что случилось. */
  title: string;
  /** Что сделать человеку — одной-двумя фразами. */
  description: string;
};

/**
 * Вид ошибки по исключению getUserMedia / LiveKit. Имена — из спецификации
 * Media Capture и старых Chrome (PermissionDeniedError, DevicesNotFoundError,
 * TrackStartError). OverconstrainedError по deviceId значит «такого микрофона
 * больше нет» — это «не найден», а не «не подходят настройки».
 */
export function classifyMicError(error: unknown): MicErrorKind {
  const name = errorName(error);
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "not-found";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "busy";
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return constraintOf(error) === "deviceId" ? "not-found" : "constraints";
    default:
      return "unknown";
  }
}

const TEXTS: Record<MicErrorKind, Omit<MicError, "kind">> = {
  denied: {
    title: "Нет доступа к микрофону",
    description:
      "Вас не слышно. Разрешите микрофон: значок слева от адреса сайта → «Микрофон» → «Разрешить», потом нажмите «Повторить».",
  },
  "not-found": {
    title: "Микрофон не найден",
    description:
      "Вас не слышно. Подключите микрофон или гарнитуру — как только он появится, нажмите «Повторить».",
  },
  busy: {
    title: "Микрофон занят",
    description:
      "Вас не слышно: микрофон держит другая программа или вкладка. Закройте её и нажмите «Повторить» или выберите другой микрофон в настройках.",
  },
  constraints: {
    title: "Микрофон не запустился с нужными настройками",
    description: "Вас не слышно. Выберите другой микрофон в настройках или нажмите «Повторить».",
  },
  unknown: {
    title: "Не получилось включить микрофон",
    description: "Вас не слышно. Нажмите «Повторить» или выберите другой микрофон в настройках.",
  },
};

/** Ошибка микрофона с текстами по её виду. */
export function micError(kind: MicErrorKind): MicError {
  return { kind, ...TEXTS[kind] };
}

/** Исключение → ошибка микрофона для интерфейса. */
export function toMicError(error: unknown): MicError {
  return micError(classifyMicError(error));
}

/** Это уже готовая ошибка микрофона (её бросает смена устройства). */
export function isMicError(v: unknown): v is MicError {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as MicError).kind === "string" &&
    typeof (v as MicError).title === "string" &&
    typeof (v as MicError).description === "string"
  );
}

function errorName(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("name" in error)) return undefined;
  const name = (error as { name: unknown }).name;
  return typeof name === "string" ? name : undefined;
}

function constraintOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("constraint" in error)) return undefined;
  const c = (error as { constraint: unknown }).constraint;
  return typeof c === "string" ? c : undefined;
}

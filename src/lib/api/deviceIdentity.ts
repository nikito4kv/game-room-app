// Устройство участника: { id, secret } в localStorage браузера. Чистые функции
// без React и без хранилища — где хранить, решает клиент (через readLocalJSON /
// writeLocalJSON из clientStorage). Сервер берёт отсюда проверку формата.
//
// id не секретен: из него получается identity участника ("u_" + id), её видят все
// в комнате. secret — ключ от места: сервер хранит только его sha256 и сверяет при
// каждом входе (TOFU). Потерял secret — в уже открытых комнатах место «занято».
import { IDENTITY_PREFIX, type DeviceIdentity } from "./contract";

const DEVICE_ID_BYTES = 16; // → 22 символа base64url
const DEVICE_SECRET_BYTES = 32; // → 43 символа base64url

// Принимаем с запасом по длине: генератор выдаёт 22/43 символа, но сервер не должен
// ломаться, если формат когда-нибудь удлинят. Короче нельзя: id — уникальность,
// secret — стойкость (минимум 32 символа ≈ 192 бита).
const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{32,128}$/;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function cryptoRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Новое устройство. Звать один раз, если в localStorage ещё нет валидного
 * (parseDeviceIdentity вернул null), и сразу сохранить. randomBytes — для тестов.
 */
export function createDeviceIdentity(
  randomBytes: (length: number) => Uint8Array = cryptoRandomBytes,
): DeviceIdentity {
  return {
    id: toBase64Url(randomBytes(DEVICE_ID_BYTES)),
    secret: toBase64Url(randomBytes(DEVICE_SECRET_BYTES)),
  };
}

/** Проверяет форму (например, прочитанного из localStorage). null — негодное. */
export function parseDeviceIdentity(raw: unknown): DeviceIdentity | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { id, secret } = raw as Record<string, unknown>;
  if (typeof id !== "string" || !ID_RE.test(id)) return null;
  if (typeof secret !== "string" || !SECRET_RE.test(secret)) return null;
  return { id, secret };
}

/** identity участника в LiveKit для этого устройства. */
export function identityForDevice(deviceId: string): string {
  return IDENTITY_PREFIX + deviceId;
}

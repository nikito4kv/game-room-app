// Устройство этого браузера: { id, secret } в localStorage под ключом gr.device.
// Одно на все комнаты: identity участника = "u_" + id, а secret — ключ от места
// (сервер сверяет его хэш при каждом входе). Создаётся при первом входе.
import type { DeviceIdentity } from "@/lib/api/contract";
import { createDeviceIdentity, parseDeviceIdentity } from "@/lib/api/deviceIdentity";
import { readLocalJSON, writeLocalJSON } from "@/lib/clientStorage";

const DEVICE_KEY = "gr.device";

const isDevice = (v: unknown): v is DeviceIdentity => parseDeviceIdentity(v) !== null;

// Держим в памяти на время жизни страницы: если хранилище недоступно (жёсткий
// приватный режим), устройство хотя бы не меняется между входами в этой вкладке.
let current: DeviceIdentity | null = null;

/** Устройство этого браузера; нет или испорчено — создаём новое и сохраняем. */
export function getDeviceIdentity(): DeviceIdentity {
  if (current) return current;
  const stored = readLocalJSON<DeviceIdentity | null>(DEVICE_KEY, null, isDevice);
  const device = stored ? parseDeviceIdentity(stored) : null;
  if (device) {
    current = device;
    return device;
  }
  const fresh = createDeviceIdentity();
  writeLocalJSON(DEVICE_KEY, fresh);
  current = fresh;
  return fresh;
}

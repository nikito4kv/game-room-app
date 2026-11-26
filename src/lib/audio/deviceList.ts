import type { DeviceInfo } from "./devices";

// Последний список устройств, который видела вкладка (с разрешением на микрофон —
// с deviceId). Опции комнаты собираются синхронно, по клику «Войти», — ждать там
// enumerateDevices некогда, и они берут список, который только что видело лобби.
let last: DeviceInfo[] = [];

/** enumerateDevices с запоминанием. Нет API или ошибка — пустой список. */
export async function listDevices(): Promise<MediaDeviceInfo[]> {
  const list = (await navigator.mediaDevices?.enumerateDevices().catch(() => null)) ?? [];
  if (list.some((d) => d.deviceId)) last = list;
  return list;
}

/** Список, который вкладка видела последним; пустой — ещё не видела. */
export function knownDevices(): DeviceInfo[] {
  return last;
}

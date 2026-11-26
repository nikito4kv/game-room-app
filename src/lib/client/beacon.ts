// Маяк посещений (А4): на каждую смену страницы браузер шлёт в POST /api/ev
// короткое событие — путь, внешний источник, метки utm_* и случайный номер
// браузера (gr:vid). Без имени, без cookie, без кода из адреса заявки (?t=).
// Чистые функции — здесь; отправка — sendPageBeacon (navigator.sendBeacon).
import type { PageBeacon } from "@/lib/api/platform";

/** Случайный номер браузера для аналитики, без связи с человеком (решение А4). */
export const VID_KEY = "gr:vid";
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign"] as const;
const UTM_MAX = 100;
const REF_MAX = 300;
const PATH_MAX = 200;

/** Страницы, которые не считаем: витрина дизайн-системы — служебная. */
export function shouldTrackPath(path: string): boolean {
  return !(path === "/design" || path.startsWith("/design/"));
}

/**
 * Источник: только внешний сайт — свой (переход внутри Game Room) не нужен.
 * Отдаём origin + путь без query: в query чужих сайтов бывают личные данные.
 */
export function externalReferrer(referrer: string, ownHost: string): string | undefined {
  if (!referrer) return undefined;
  let u: URL;
  try {
    u = new URL(referrer);
  } catch {
    return undefined;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
  if (u.host === ownHost) return undefined;
  return `${u.origin}${u.pathname === "/" ? "" : u.pathname}`.slice(0, REF_MAX);
}

/** Тело маяка из пути, query-строки адреса, document.referrer и vid. */
export function buildPageBeacon(input: {
  path: string;
  search: string;
  referrer: string;
  host: string;
  vid: string | null;
}): PageBeacon {
  const params = new URLSearchParams(input.search);
  const beacon: PageBeacon = { path: input.path.slice(0, PATH_MAX) || "/" };
  const ref = externalReferrer(input.referrer, input.host);
  if (ref) beacon.ref = ref;
  for (const key of UTM_KEYS) {
    const v = params.get(key)?.trim();
    if (v) beacon[key] = v.slice(0, UTM_MAX);
  }
  if (input.vid) beacon.vid = input.vid;
  return beacon;
}

/** Новый случайный vid: 16 байт в base64url (22 символа), как номер устройства. */
export function newVid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const VID_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** vid из localStorage; нет — создаём. Хранилище закрыто (приватный режим) — null: шлём без vid. */
export function getOrCreateVid(): string | null {
  try {
    const cur = localStorage.getItem(VID_KEY);
    if (cur && VID_RE.test(cur)) return cur;
    const next = newVid();
    localStorage.setItem(VID_KEY, next);
    return localStorage.getItem(VID_KEY) === next ? next : null;
  } catch {
    return null;
  }
}

/**
 * Отправить маяк. Не вышло — молча: аналитика не должна мешать странице.
 * withReferrer — только для первой страницы визита: при переходах внутри сайта
 * document.referrer остаётся прежним, и источник засчитался бы каждой странице.
 */
export function sendPageBeacon(path: string, withReferrer: boolean): void {
  try {
    if (!shouldTrackPath(path)) return;
    const body = buildPageBeacon({
      path,
      search: window.location.search,
      referrer: withReferrer ? document.referrer : "",
      host: window.location.host,
      vid: getOrCreateVid(),
    });
    const json = JSON.stringify(body);
    if (typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon("/api/ev", new Blob([json], { type: "application/json" }));
    } else {
      void fetch("/api/ev", { method: "POST", body: json, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(
        () => {},
      );
    }
  } catch {
    // нет сети, запрет политики, старый браузер — страница работает дальше
  }
}

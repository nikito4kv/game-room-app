// События Румика (R2, R5) для воронки в админке: рядом с главной метрикой
// «зашёл → создал комнату» (room_created) — сколько открыли рисовалку, начали
// рисовать, сохранили и загрузили файл, скачали открытку. Каждое уходит в два
// места: в PostHog (имена — в EVENTS) и маяком в поток событий сайта (/api/ev,
// RumikBeacon) — его видит админка. Ника и комнаты в событии нет; номер
// браузера (gr:vid) тот же, что у страниц и создания комнаты.
import type { RumikBeacon, RumikEventName, RumikPlace } from "@/lib/api/platform";
import { getOrCreateVid, shouldTrackPath } from "@/lib/client/beacon";
import { EVENTS, track } from "./posthogClient";

/** Где рисовалка: герой главной или окно «Раскрасить» в лобби. */
export type { RumikPlace };

/** Что сделали в рисовалке (их сообщает RumikEditor через onEvent). */
export type RumikEditorEvent = "paint_started" | "file_saved" | "file_loaded";

const EDITOR_EVENTS: Record<RumikEditorEvent, RumikEventName> = {
  paint_started: EVENTS.rumikPaintStarted,
  file_saved: EVENTS.rumikFileSaved,
  file_loaded: EVENTS.rumikFileLoaded,
};

const started = new Set<RumikPlace>();

/**
 * Маяк в поток событий сайта. Не вышло — молча: аналитика не мешает рисовать.
 * Витрину дизайн-системы (/design) не считаем — как и страницы.
 */
function beacon(ev: RumikEventName, place: RumikPlace, pose?: string): void {
  try {
    if (typeof window === "undefined" || !shouldTrackPath(window.location.pathname)) return;
    const vid = getOrCreateVid();
    const body: RumikBeacon = { ev, place, ...(pose ? { pose } : {}), ...(vid ? { vid } : {}) };
    const json = JSON.stringify(body);
    if (typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon("/api/ev", new Blob([json], { type: "application/json" }));
    } else {
      void fetch("/api/ev", { method: "POST", body: json, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(
        () => {},
      );
    }
  } catch {
    // нет сети, запрет политики, старый браузер — рисовалка работает дальше
  }
}

function send(ev: RumikEventName, place: RumikPlace, pose?: string): void {
  track(ev, pose ? { place, pose } : { place });
  beacon(ev, place, pose);
}

/** Событие рисовалки. «Начал рисовать» — один раз за визит (загрузку страницы) на каждом месте. */
export function trackRumikEditor(event: RumikEditorEvent, place: RumikPlace): void {
  if (event === "paint_started") {
    if (started.has(place)) return;
    started.add(place);
  }
  send(EDITOR_EVENTS[event], place);
}

/** Открыл рисовалку (в лобби — кнопкой «Раскрасить»; на главной она открыта всегда). */
export function trackRumikEditorOpened(place: RumikPlace): void {
  send(EVENTS.rumikEditorOpened, place);
}

/** Открытку скачали файлом или отправили через «Поделиться». */
export function trackPostcard(how: "downloaded" | "shared", place: RumikPlace, pose: string): void {
  send(how === "downloaded" ? EVENTS.rumikPostcardDownloaded : EVENTS.rumikPostcardShared, place, pose);
}

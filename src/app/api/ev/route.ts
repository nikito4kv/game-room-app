import { RUMIK_EVENTS, RUMIK_PLACES, type RumikEventName, type RumikPlace } from "@/lib/api/platform";
import { beaconLimit, clientIp, consumeLimit } from "@/lib/ratelimit";
import { emitEvent, type EventInput } from "@/lib/platform/events";

// POST /api/ev — маяк из браузера (navigator.sendBeacon, тело — JSON; тип
// содержимого не важен). Два вида тела из src/lib/api/platform.ts:
//   • PageBeacon { path, … } — посещение страницы;
//   • RumikBeacon { ev, place, … } — событие рисовалки Румика (строгий белый
//     список RUMIK_EVENTS и RUMIK_PLACES).
// Лимит один на оба вида. Ответ всегда 204: маяку нечего показывать человеку, а
// отказы только учили бы ботов, — мусор молча отбрасывается.

const MAX_BODY = 2 * 1024;
/** Поза открытки: имя позы Румика (stand, waveL…). */
const POSE_RE = /^[A-Za-z]{1,12}$/;

const str = (x: unknown, max: number): string | undefined => {
  if (typeof x !== "string") return undefined;
  // Управляющие символы — мусор для аналитики.
  const s = x.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return s ? s.slice(0, max) : undefined;
};

/** Значение из белого списка (только собственные ключи: «constructor» и т. п. не пройдут). */
const pick = <K extends string>(list: Record<K, string>, x: unknown): K | null =>
  typeof x === "string" && Object.hasOwn(list, x) ? (x as K) : null;

const noContent = () => new Response(null, { status: 204 });

/** Событие рисовалки из тела; null — мусор. */
function rumikEvent(body: Record<string, unknown>): EventInput | null {
  const name = pick<RumikEventName>(RUMIK_EVENTS, body.ev);
  const place = pick<RumikPlace>(RUMIK_PLACES, body.place);
  if (!name || !place) return null;
  if (body.pose !== undefined && (typeof body.pose !== "string" || !POSE_RE.test(body.pose))) return null;
  return { t: "rumik", name, place, pose: body.pose as string | undefined, vid: str(body.vid, 64) };
}

/** Посещение страницы из тела; null — мусор. */
function pageEvent(body: Record<string, unknown>, ip: string): EventInput | null {
  const path = str(body.path, 200);
  if (!path || !path.startsWith("/")) return null;
  return {
    t: "page",
    path,
    ref: str(body.ref, 300),
    utm_source: str(body.utm_source, 100),
    utm_medium: str(body.utm_medium, 100),
    utm_campaign: str(body.utm_campaign, 100),
    vid: str(body.vid, 64),
    ip: ip !== "local" ? ip : undefined,
  };
}

export async function POST(request: Request) {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return noContent();
  }
  if (!text || text.length > MAX_BODY) return noContent();
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return noContent();
    body = parsed as Record<string, unknown>;
  } catch {
    return noContent();
  }

  const ip = clientIp(request);
  const ev = "ev" in body ? rumikEvent(body) : pageEvent(body, ip);
  if (!ev) return noContent();

  const limit = await consumeLimit(beaconLimit(), ip);
  if (limit.limited) return noContent();

  await emitEvent(ev);
  return noContent();
}

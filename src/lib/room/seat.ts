// Место участника в комнате: значок в углу аватара, подпись для скринридера,
// короткий ник и порядок мест. Чистые функции — их же использует мини-комната
// поверх игры.

import type { AvatarStatus } from "@/components/ui/Avatar";

/**
 * Что известно о голосе участника. Свои deafened и pttIdle берём из своих
 * контекстов, чужие — из атрибутов участника (remoteSeatVoice).
 */
export type SeatVoice = {
  /** Хост выключил микрофон. */
  forceMuted: boolean;
  /** Выключил себе звук. */
  deafened: boolean;
  /** Рация включена и ждёт нажатия клавиши (трек при этом заглушён). */
  pttIdle: boolean;
  /** Микрофон выключен или не опубликован. */
  micOff: boolean;
};

/**
 * Значок в углу аватара — одна, самая важная причина. «Хост заглушил» важнее
 * всего: это не выбор человека. «Звук выкл» важнее мьюта: такой человек и не
 * слышит. Рация, которая ждёт клавишу, не должна выглядеть как мьют (аудит F-С3).
 */
export function seatStatus(v: SeatVoice): AvatarStatus | null {
  if (v.forceMuted) return "forceMuted";
  if (v.deafened) return "deafened";
  if (v.pttIdle) return "ptt";
  if (v.micOff) return "muted";
  return null;
}

/**
 * Голос другого участника. «Звук выкл» и рация приходят атрибутами от сервера
 * (POST /api/voice), мьют — по треку. Рация «ждёт», пока трек заглушён; пока
 * человек держит клавишу, трек открыт — значка нет, видно кольцо «говорит».
 */
export function remoteSeatVoice(v: {
  forceMuted: boolean;
  micOff: boolean;
  deafened: boolean;
  ptt: boolean;
}): SeatVoice {
  return { forceMuted: v.forceMuted, micOff: v.micOff, deafened: v.deafened, pttIdle: v.ptt && v.micOff };
}

const STATUS_TEXT: Record<AvatarStatus, string> = {
  muted: "микрофон выключен",
  deafened: "звук выключен",
  forceMuted: "заглушён хостом",
  ptt: "в режиме рации",
};

/** Состояние голоса словами: «звук выключен», «в режиме рации»… */
export function seatStatusText(status: AvatarStatus): string {
  return STATUS_TEXT[status];
}

export type SeatFacts = {
  name: string;
  me: boolean;
  host: boolean;
  speaking: boolean;
  status: AvatarStatus | null;
  streaming: boolean;
  /** Связь слабая или пропала. */
  poorLink: boolean;
  /** Свой пинг, мс (чужой неизвестен). */
  pingMs?: number | null;
  /** Я заглушил этого человека для себя. */
  mutedForMe: boolean;
  /** Свой статус человека словами: «в игре: CS2», «отошёл». */
  manual?: string | null;
};

/**
 * Всё состояние места одной фразой — aria-label кнопки места: «Тёма, хост,
 * говорит, показывает экран». Ник не склоняем.
 */
export function seatLabel(f: SeatFacts): string {
  const parts = [f.name];
  if (f.me) parts.push("это вы");
  if (f.host) parts.push("хост");
  if (f.speaking) parts.push("говорит");
  if (f.status) parts.push(STATUS_TEXT[f.status]);
  if (f.manual) parts.push(f.manual);
  if (f.mutedForMe) parts.push("заглушён для вас");
  if (f.streaming) parts.push("показывает экран");
  if (f.poorLink) parts.push(f.pingMs ? `слабая связь, ${f.pingMs} мс` : "слабая связь");
  return parts.join(", ");
}

/**
 * Где стоит ник: под Румиком за столом, место за круглым столом (крупное или
 * среднее), строка списка, чип ленты под сценой.
 */
export type NameSlot = "figure" | "lg" | "md" | "list" | "chip";

/**
 * Строка подписи места: ширина (px, max-w в разметке места) и ширина буквы с
 * запасом. Буквы замерены в браузере шрифтом Onest 500: строчная кириллица в
 * среднем 8,4 px при 14 px и 7,8 px при 13 px, заглавные шире. Запас — чтобы
 * ник почти никогда не упирался в CSS-обрезку (у неё дыра перед «· вы»).
 */
const NAME_SLOT: Record<NameSlot, { width: number; char: number }> = {
  // Подпись под Румиком не шире места × 1,1: на столе среднего размера
  // (арена ~700 px, место 19 %) это ~145 px, берём с запасом.
  figure: { width: 120, char: 8.4 },
  lg: { width: 128, char: 9 },
  md: { width: 104, char: 8.4 },
  chip: { width: 128, char: 8.4 },
  // Строка списка тянется; 180 px остаётся и на 360 px со значками справа.
  list: { width: 180, char: 9 },
};
/** Корона и «заглушён для вас»: иконка 14 + зазор 4. «· вы» с зазором — 29. */
const CROWN_PX = 18;
const ME_PX = 29;
const MUTED_PX = 18;
/** Значок статуса (эмодзи ступенью подписи) + зазор. */
const MANUAL_PX = 22;
/** В подписи под Румиком: значок «Экран» (пилюля 24 + зазор) и столбики связи (13 + зазор). */
const STREAM_PX = 28;
const LINK_PX = 17;

/**
 * Сколько символов ника (вместе с «…») влезает в подпись места. Корона, «· вы»,
 * значки статуса и «заглушён для вас» (а под Румиком ещё «Экран» и связь) стоят
 * в той же строке и забирают своё место.
 */
export function nameBudget(
  slot: NameSlot,
  extras: {
    host: boolean;
    me: boolean;
    mutedForMe: boolean;
    streaming?: boolean;
    poorLink?: boolean;
    manual?: boolean;
  },
): number {
  const s = NAME_SLOT[slot];
  const room =
    s.width -
    (extras.host ? CROWN_PX : 0) -
    (extras.me ? ME_PX : 0) -
    (extras.mutedForMe ? MUTED_PX : 0) -
    (extras.manual ? MANUAL_PX : 0) -
    (extras.streaming ? STREAM_PX : 0) -
    (extras.poorLink ? LINK_PX : 0);
  return Math.max(6, Math.floor(room / s.char));
}

// Хвост, который не оставляем перед «…»: иначе выходит «Артемий …» с дырой.
const TAIL = /[\s_.,·\-–—]+$/u;

function graphemes(text: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

/**
 * Ник не длиннее max символов вместе с «…». Режем по графемам — эмодзи и
 * буквы с диакритикой не разваливаются. Обрезанный ник целиком показывает
 * подсказка у места, а скринридер читает его из aria-label.
 */
export function shortName(name: string, max: number): string {
  const chars = graphemes(name);
  if (chars.length <= max) return name;
  const head = chars.slice(0, Math.max(1, max - 1)).join("");
  return `${head.replace(TAIL, "") || head}…`;
}

/**
 * Сколько людей влезает в строку мини-комнаты поверх игры шириной width.
 * Обычный вид: место 50 + зазор 12, поля по 12. Сжатый: аватар 32 + зазор 8;
 * поля 10 слева и 10 справа, кнопка микрофона 40 и зазоры вокруг неё 8 + 8.
 * Не влезли все — последнее место отдаём под «+N».
 */
export function pipVisibleCount(total: number, width: number, compact: boolean): number {
  const slot = compact ? 40 : 62;
  const room = compact ? width - 76 + 8 : width - 24 + 12;
  const capacity = Math.max(1, Math.floor(room / slot));
  return total <= capacity ? total : Math.max(1, capacity - 1);
}

/**
 * Порядок мест — по времени входа, при равенстве (сервер считает в секундах) —
 * по identity. Так у всех клиентов одинаковые и рассадка, и цвета аватаров
 * (assignAvatarColors раздаёт цвета в этом же порядке).
 */
export function sortByJoin<T extends { identity: string; joinedAt?: Date }>(people: readonly T[]): T[] {
  return [...people].sort((a, b) => {
    const ta = a.joinedAt?.getTime() ?? 0;
    const tb = b.joinedAt?.getTime() ?? 0;
    if (ta !== tb) return ta - tb;
    return a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0;
  });
}

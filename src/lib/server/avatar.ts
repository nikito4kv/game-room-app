// ВАЖНО: только сервер. Рисунок Румика, который видят другие в комнате (R4).
//
//   gr:avatar:<id>        STRING base64 PNG AVATAR_WIDTH×AVATAR_HEIGHT; живёт
//                         AVATAR_TTL_DAYS, каждый POST с тем же рисунком продлевает
//   gr:avatarblock:<id>   STRING JSON { reason, at } — скрыт администрацией, столько же
//   gr:avatarhidden:<id>  STRING скрытая картинка — её отдаёт только внутренний API
//                         (миниатюра в жалобе и журнале, доказательство); живёт как жалоба
//   gr:avatarban:<CODE>:<identity>  STRING JSON { reason, at } — рисунки этого участника
//                         в комнате скрыты (сброс администрацией); живёт как комната
//   gr:avatarday:<YYYY-MM-DD>  счётчик байт новых рисунков за сутки (UTC) на весь сайт
//
// id — хэш содержимого: одинаковые картинки лежат одной записью, а адрес
// /api/avatar/<id> не меняется, пока не поменялась картинка, — браузер держит
// её в кеше. Чей рисунок, сервер обычно не знает: связь «человек → id» живёт в
// атрибуте участника LiveKit (AVATAR_ATTRIBUTE), пока он в комнате. Записывается
// она только по жалобе (id рисунка в жалобе) и при сбросе администрацией (в
// журнале админки).
import { createHash } from "node:crypto";
import { crc32, inflateSync } from "node:zlib";
import type { ParticipantInfo } from "livekit-server-sdk";
import {
  AVATAR_ATTRIBUTE,
  AVATAR_HEIGHT,
  AVATAR_MAX_BYTES,
  AVATAR_TTL_DAYS,
  AVATAR_WIDTH,
  isAvatarId,
} from "@/lib/api/contract";
import { DEFAULT_RUNTIME_CONFIG, type AdminReason, type RuntimeConfig } from "@/lib/api/platform";
import { getRoomService, isNotFoundError } from "@/lib/livekit";
import { REPORT_TTL_SEC } from "@/lib/platform/reports";
import { loadRuntimeConfig } from "@/lib/platform/runtimeConfig";
import { getRedisRaw } from "@/lib/redis";
import { ROOM_STATE_TTL_SECONDS } from "@/lib/roomSecret";
import { getParticipantOrNull } from "./roomSync";

export const AVATAR_TTL_SEC = AVATAR_TTL_DAYS * 24 * 60 * 60;
/** Скрытый рисунок админка видит столько же, сколько живёт жалоба на него. */
export const AVATAR_HIDDEN_TTL_SEC = REPORT_TTL_SEC;
/** Запрет рисунков участнику в комнате после сброса — столько, сколько самое долгое живёт комната. */
export const AVATAR_BAN_TTL_SEC = ROOM_STATE_TTL_SECONDS;
/**
 * Суточный бюджет новых рисунков на весь сайт, байт PNG (в Redis base64 — на
 * треть больше). Румик, нарисованный кистью, весит 5–20 КБ — это 400–1600 новых
 * рисунков в сутки; самых тяжёлых (AVATAR_MAX_BYTES) — 256. За AVATAR_TTL_DAYS
 * хранилище рисунков не вырастет больше чем до ~330 МБ, сколько бы их ни слали.
 * Повтор уже лежащего рисунка (вход с тем же) бюджет не тратит.
 * Сам бюджет — настройка продукта limits.avatarDayBudgetMb (здесь — умолчание).
 */
export const AVATAR_DAY_BUDGET_BYTES = DEFAULT_RUNTIME_CONFIG.limits.avatarDayBudgetMb * 1024 * 1024;

/** Бюджет новых рисунков в сутки по настройкам продукта, байт. */
export const avatarDayBudgetBytes = (cfg: RuntimeConfig) => cfg.limits.avatarDayBudgetMb * 1024 * 1024;

/** Начала ключей хранилища — для подсчёта во внутреннем API (/api/internal/avatars). */
export const AVATAR_KEY_PREFIX = { data: "gr:avatar:", hidden: "gr:avatarhidden:" } as const;

const dataKey = (id: string) => `${AVATAR_KEY_PREFIX.data}${id}`;
const blockKey = (id: string) => `gr:avatarblock:${id}`;
const hiddenKey = (id: string) => `${AVATAR_KEY_PREFIX.hidden}${id}`;
const banKey = (code: string, identity: string) => `gr:avatarban:${code}:${identity}`;
/** Счётчик байт новых рисунков за сутки (UTC). */
export const avatarDayKey = (now: Date) => `gr:avatarday:${now.toISOString().slice(0, 10)}`;

// ── Проверка PNG ─────────────────────────────────────────────────────────────

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/**
 * Что оставляем от файла. Прочие вспомогательные чанки (текст, EXIF, время,
 * метки редакторов вроде iDOT у Safari) выкидываем: картинке они не нужны, а
 * чужим глазам не нужны тем более.
 */
const KEEP = new Set(["IHDR", "PLTE", "tRNS", "sRGB", "gAMA", "IDAT", "IEND"]);
/** Чанки APNG: анимацию не принимаем, даже если без неё картинка читается. */
const ANIMATION = new Set(["acTL", "fcTL", "fdAT"]);
const CRITICAL = new Set(["IHDR", "PLTE", "IDAT", "IEND"]);
/** Каналов на пиксель по типу цвета PNG и допустимые глубины. */
const COLOR_TYPES: Record<number, { channels: number; depths: number[] }> = {
  0: { channels: 1, depths: [1, 2, 4, 8, 16] },
  2: { channels: 3, depths: [8, 16] },
  3: { channels: 1, depths: [1, 2, 4, 8] },
  4: { channels: 2, depths: [8, 16] },
  6: { channels: 4, depths: [8, 16] },
};

export type PngProblem = "not_png" | "too_big" | "size" | "animated" | "broken";
export type PngCheck = { ok: true; png: Buffer } | { ok: false; problem: PngProblem };

const isChunkType = (b: Buffer) => [...b].every((c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122));

/**
 * Настоящий ли это PNG нужного размера. Проверяем всё, что дешево проверить:
 * подпись, порядок и контрольные суммы чанков, IHDR (ровно AVATAR_WIDTH×
 * AVATAR_HEIGHT, без чересстрочности), отсутствие анимации и хвоста после IEND,
 * и что сжатые данные распаковываются ровно в картинку такого размера. Ответ —
 * очищенный файл (без лишних чанков): его и храним, по нему и считаем id.
 */
export function checkAvatarPng(buf: Buffer): PngCheck {
  if (buf.length > AVATAR_MAX_BYTES) return { ok: false, problem: "too_big" };
  if (buf.length < SIGNATURE.length + 12 || !buf.subarray(0, 8).equals(SIGNATURE)) {
    return { ok: false, problem: "not_png" };
  }
  const kept: Buffer[] = [SIGNATURE];
  const idat: Buffer[] = [];
  let header: { width: number; height: number; depth: number; color: number; interlace: number } | null = null;
  let palette = false;
  let dropped = false;
  let off = SIGNATURE.length;
  for (;;) {
    if (off + 12 > buf.length) return { ok: false, problem: "broken" };
    const len = buf.readUInt32BE(off);
    const end = off + 12 + len;
    if (len > buf.length || end > buf.length) return { ok: false, problem: "broken" };
    const typeBytes = buf.subarray(off + 4, off + 8);
    if (!isChunkType(typeBytes)) return { ok: false, problem: "broken" };
    const type = typeBytes.toString("latin1");
    if (crc32(buf.subarray(off + 4, off + 8 + len)) !== buf.readUInt32BE(off + 8 + len)) {
      return { ok: false, problem: "broken" };
    }
    const data = buf.subarray(off + 8, off + 8 + len);
    if (ANIMATION.has(type)) return { ok: false, problem: "animated" };
    // IHDR — первым и один раз; критические чанки, которых мы не знаем, — отказ.
    if ((type === "IHDR") !== (header === null)) return { ok: false, problem: "broken" };
    if (type[0]! <= "Z" && !CRITICAL.has(type)) return { ok: false, problem: "broken" };
    if (type === "IHDR") {
      if (len !== 13) return { ok: false, problem: "broken" };
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8]!,
        color: data[9]!,
        interlace: data[12]!,
      };
      const kind = COLOR_TYPES[header.color];
      if (!kind || !kind.depths.includes(header.depth) || data[10] !== 0 || data[11] !== 0 || header.interlace > 1) {
        return { ok: false, problem: "broken" };
      }
      if (header.width !== AVATAR_WIDTH || header.height !== AVATAR_HEIGHT) return { ok: false, problem: "size" };
      // Чересстрочный PNG канва не делает, а распаковку он усложняет.
      if (header.interlace !== 0) return { ok: false, problem: "broken" };
    }
    if (type === "PLTE") palette = true;
    if (type === "IDAT") idat.push(data);
    if (KEEP.has(type)) kept.push(buf.subarray(off, end));
    else dropped = true;
    off = end;
    if (type === "IEND") {
      if (len !== 0 || off !== buf.length) return { ok: false, problem: "broken" };
      break;
    }
  }
  if (!header || idat.length === 0 || (header.color === 3 && !palette)) return { ok: false, problem: "broken" };
  if (!pixelsFit(Buffer.concat(idat), header)) return { ok: false, problem: "broken" };
  return { ok: true, png: dropped ? Buffer.concat(kept) : buf };
}

/** Сжатые данные распаковываются ровно в height строк нужной длины с фильтрами 0–4. */
function pixelsFit(compressed: Buffer, h: { width: number; height: number; depth: number; color: number }): boolean {
  const rowBytes = 1 + Math.ceil((h.width * COLOR_TYPES[h.color]!.channels * h.depth) / 8);
  const expected = rowBytes * h.height;
  let raw: Buffer;
  try {
    raw = inflateSync(compressed, { maxOutputLength: expected + 1 });
  } catch {
    return false;
  }
  if (raw.length !== expected) return false;
  for (let row = 0; row < h.height; row++) if (raw[row * rowBytes]! > 4) return false;
  return true;
}

/** Самая длинная строка base64 для файла не больше AVATAR_MAX_BYTES. */
const BASE64_MAX = Math.ceil(AVATAR_MAX_BYTES / 3) * 4;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export type AvatarBody = { ok: true; png: Buffer | null } | { ok: false; problem: PngProblem | "bad_request" };

/**
 * Поле png из тела POST /api/avatar: null — снять рисунок, строка base64 —
 * проверенный и очищенный PNG. Поле обязательно: его отсутствие — кривой запрос,
 * а не «снять».
 */
export function parseAvatarBody(body: Record<string, unknown>): AvatarBody {
  const raw = body.png;
  if (raw === null) return { ok: true, png: null };
  if (typeof raw !== "string" || !raw) return { ok: false, problem: "bad_request" };
  if (raw.length > BASE64_MAX) return { ok: false, problem: "too_big" };
  if (!BASE64_RE.test(raw)) return { ok: false, problem: "not_png" };
  return checkAvatarPng(Buffer.from(raw, "base64"));
}

/** id рисунка: sha256 содержимого, первые 16 символов base64url (96 бит). */
export function avatarIdOf(png: Buffer): string {
  return createHash("sha256").update(png).digest("base64url").slice(0, 16);
}

// ── Хранилище ────────────────────────────────────────────────────────────────

/**
 * Продлить срок уже лежащего рисунка. false — его нет (истёк или новый): тогда
 * его надо положить (putAvatar). Повтор не тратит лимит новых рисунков.
 */
export async function refreshAvatar(id: string): Promise<boolean> {
  return Number(await getRedisRaw().expire(dataKey(id), AVATAR_TTL_SEC)) === 1;
}

export async function putAvatar(id: string, png: Buffer): Promise<void> {
  await getRedisRaw().set(dataKey(id), png.toString("base64"), { ex: AVATAR_TTL_SEC });
}

/**
 * Почему рисунок не принять: "avatar" — этот рисунок скрыт администрацией,
 * "person" — скрыты все рисунки этого участника в комнате; null — можно.
 */
export async function avatarRefusal(code: string, identity: string, id: string): Promise<"avatar" | "person" | null> {
  const [blocked, banned] = (await getRedisRaw().mget(blockKey(id), banKey(code, identity))) as (string | null)[];
  return blocked ? "avatar" : banned ? "person" : null;
}

/**
 * Списать size байт из суточного бюджета новых рисунков (настройка продукта
 * limits.avatarDayBudgetMb); false — бюджет на сегодня исчерпан. Отказ тоже
 * списывается: сверх бюджета счётчик только растёт, а назавтра начинается новый
 * ключ. Redis недоступен — пропускаем (как лимиты частоты): положить картинку
 * тогда всё равно не выйдет.
 */
export async function consumeAvatarBudget(size: number, now: Date = new Date()): Promise<boolean> {
  try {
    const budget = avatarDayBudgetBytes(await loadRuntimeConfig());
    const p = getRedisRaw().pipeline();
    p.incrby(avatarDayKey(now), size);
    p.expire(avatarDayKey(now), 2 * 24 * 60 * 60);
    const [total] = (await p.exec()) as [number, number];
    return Number(total) <= budget;
  } catch (err) {
    console.error("avatar: day budget check failed", err);
    return true;
  }
}

/** Картинка для GET; нет, истекла или скрыта — null. */
export async function loadAvatar(id: string): Promise<Buffer | null> {
  if (!isAvatarId(id)) return null;
  const [data, blocked] = (await getRedisRaw().mget(dataKey(id), blockKey(id))) as (string | null)[];
  if (blocked || typeof data !== "string" || !data) return null;
  return Buffer.from(data, "base64");
}

/**
 * Картинка для админки (внутренний API): и живая, и скрытая администрацией —
 * миниатюры в жалобах и журнале не ломаются после сброса. hidden — скрыта.
 */
export async function loadAvatarForAdmin(id: string): Promise<{ png: Buffer; hidden: boolean } | null> {
  if (!isAvatarId(id)) return null;
  const [data, hidden] = (await getRedisRaw().mget(dataKey(id), hiddenKey(id))) as (string | null)[];
  if (typeof data === "string" && data) return { png: Buffer.from(data, "base64"), hidden: false };
  if (typeof hidden === "string" && hidden) return { png: Buffer.from(hidden, "base64"), hidden: true };
  return null;
}

/**
 * Скрыть рисунок: отметка «нельзя» на срок хранения (тот же рисунок загрузить
 * снова не выйдет), а картинка переезжает под ключ, который отдаёт только
 * внутренний API: всем, кто ещё не скачал её, — 404, а у администрации остаётся
 * доказательство на срок жизни жалобы.
 */
export async function blockAvatar(id: string, reason: AdminReason, now: Date = new Date()): Promise<void> {
  const redis = getRedisRaw();
  const data = (await redis.get(dataKey(id))) as string | null;
  const p = redis.pipeline();
  p.set(blockKey(id), JSON.stringify({ reason, at: now.toISOString() }), { ex: AVATAR_TTL_SEC });
  if (typeof data === "string" && data) p.set(hiddenKey(id), data, { ex: AVATAR_HIDDEN_TTL_SEC });
  p.del(dataKey(id));
  await p.exec();
}

// ── Атрибут участника ────────────────────────────────────────────────────────

/**
 * Пишет id рисунка в атрибут участника (null — снять: пустое значение LiveKit
 * понимает как удаление ключа); metadata и права не трогает. Заодно проверка
 * «сейчас в комнате»: ушедшего LiveKit не найдёт — false.
 */
export async function applyAvatarAttribute(code: string, identity: string, id: string | null): Promise<boolean> {
  try {
    await getRoomService().updateParticipant(code, identity, { attributes: { [AVATAR_ATTRIBUTE]: id ?? "" } });
    return true;
  } catch (err) {
    if (isNotFoundError(err)) return false;
    throw err;
  }
}

/**
 * id рисунка участника глазами сервера. Server SDK переводит ключи атрибутов в
 * camelCase (avatar.id → avatarId), поэтому смотрим оба написания.
 */
export function avatarIdOfParticipant(p: Pick<ParticipantInfo, "attributes">): string | null {
  const a = p.attributes ?? {};
  const id = a[AVATAR_ATTRIBUTE] ?? a.avatarId;
  return isAvatarId(id) ? id : null;
}

export type AvatarReset =
  /** avatarId — что было у участника сейчас (или из запроса), hidden — все скрытые id. */
  | { ok: true; avatarId: string; cleared: boolean; hidden: string[] }
  | { ok: false; reason: "no_avatar" };

/** Запретить участнику рисунки в комнате, пока жива комната (AVATAR_BAN_TTL_SEC). */
async function banAvatars(code: string, identity: string, reason: AdminReason, now: Date): Promise<void> {
  await getRedisRaw().set(banKey(code, identity), JSON.stringify({ reason, at: now.toISOString() }), {
    ex: AVATAR_BAN_TTL_SEC,
  });
}

/**
 * «Сбросить рисунок» от администрации. Скрывается и рисунок, который сейчас у
 * участника (сервер читает его атрибут сам, а не верит снимку админки), и
 * avatarId из запроса — тот, что видела администрация (в жалобе или карточке),
 * если человек его уже сменил или ушёл. Атрибут снимается, а новые рисунки этого
 * участника в комнате не принимаются, пока она жива: иначе рисунок, изменённый
 * на пиксель, прошёл бы мимо отметки. cleared — снят ли атрибут сейчас.
 */
export async function resetAvatar(
  code: string,
  identity: string,
  avatarId: string | null,
  reason: AdminReason,
  now: Date = new Date(),
): Promise<AvatarReset> {
  const live = await getParticipantOrNull(code, identity);
  const shown = live ? avatarIdOfParticipant(live) : null;
  const hidden = [...new Set([shown, avatarId].filter((x): x is string => x !== null))];
  if (hidden.length === 0) return { ok: false, reason: "no_avatar" };
  for (const id of hidden) await blockAvatar(id, reason, now);
  await banAvatars(code, identity, reason, now);
  const cleared = shown !== null && (await applyAvatarAttribute(code, identity, null));
  return { ok: true, avatarId: shown ?? hidden[0]!, cleared, hidden };
}

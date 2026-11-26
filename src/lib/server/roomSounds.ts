// ВАЖНО: только сервер. Свои звуки комнаты (раздел «Звуки комнаты» контракта):
//
//   gr:snd:<CODE>:<id>   STRING base64 файла; живёт как состояние комнаты (48 ч)
//   gr:sndlist:<CODE>    HASH id → JSON { name, by, mime, at }; тот же срок
//
// id — «c_» и 12 hex от содержимого: тот же файл в той же комнате — один звук.
// Файл проверяем по первым байтам (а не по расширению и заголовку клиента): в
// хранилище и в ответ уходит только то, что похоже на аудио, и с типом, который
// определили мы. Длину в секундах сервер не знает — её держит клиент (до
// SOUND_FILE_MAX_SEC), а против больших файлов — потолок в байтах.
import { createHash } from "node:crypto";
import {
  SOUND_FILE_MAX_BYTES,
  SOUND_MAX_PER_ROOM,
  SOUND_NAME_MAX,
  type RoomSound,
  type SoundId,
} from "@/lib/api/contract";
import { getRedisRaw } from "@/lib/redis";
import { ROOM_STATE_TTL_SECONDS } from "@/lib/roomSecret";

const fileKey = (code: string, id: string) => `gr:snd:${code}:${id}`;
const listKey = (code: string) => `gr:sndlist:${code}`;

export type SoundMime = "audio/mpeg" | "audio/ogg" | "audio/wav" | "audio/mp4" | "audio/webm";

/** Тип аудио по первым байтам; не аудио — null. */
export function sniffAudio(b: Buffer): SoundMime | null {
  if (b.length < 12) return null;
  if (b.subarray(0, 4).toString("latin1") === "OggS") return "audio/ogg";
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WAVE")
    return "audio/wav";
  if (b.subarray(0, 3).toString("latin1") === "ID3") return "audio/mpeg";
  // Кадр mp3: 11 единичных бит синхронизации (0xFFE…), слой не «reserved».
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0) return "audio/mpeg";
  if (b.subarray(4, 8).toString("latin1") === "ftyp") return "audio/mp4";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "audio/webm";
  return null;
}

// Управляющие символы и разворот строки — как в чате и статусе.
const NAME_STRIP = /\p{Cc}|[؜‎‏‪-‮⁦-⁩]/gu;

/** Название на кнопке: без управляющих, пробелы схлопнуты, не длиннее SOUND_NAME_MAX; пусто — "". */
export function cleanSoundName(raw: string): string {
  return [...raw.replace(NAME_STRIP, "").replace(/\s+/gu, " ").trim()].slice(0, SOUND_NAME_MAX).join("").trim();
}

export type SoundUpload = { name: string; data: Buffer; mime: SoundMime };

/** Тело POST: название и файл. Кривое, не аудио или больше потолка — null (SOUND_INVALID). */
export function parseSoundUpload(body: Record<string, unknown>): SoundUpload | null {
  const name = typeof body.name === "string" ? cleanSoundName(body.name) : "";
  const text = typeof body.data === "string" ? body.data : "";
  // base64 длиннее потолка в 4/3 раза: огромное тело отсекаем, не раскодируя.
  if (!name || !text || text.length > Math.ceil(SOUND_FILE_MAX_BYTES / 3) * 4 + 8) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
  const data = Buffer.from(text, "base64");
  if (data.length === 0 || data.length > SOUND_FILE_MAX_BYTES) return null;
  const mime = sniffAudio(data);
  return mime ? { name, data, mime } : null;
}

/** id звука по содержимому. */
export function customSoundId(data: Buffer): SoundId {
  return `c_${createHash("sha256").update(data).digest("hex").slice(0, 12)}`;
}

type StoredSound = { name: string; by: string; mime: SoundMime; at: number };

function decode(raw: unknown): StoredSound | null {
  try {
    const o: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (typeof o !== "object" || o === null) return null;
    const r = o as Record<string, unknown>;
    if (typeof r.name !== "string" || typeof r.by !== "string" || typeof r.mime !== "string") return null;
    return { name: r.name, by: r.by, mime: r.mime as SoundMime, at: Number(r.at) || 0 };
  } catch {
    return null;
  }
}

function fields(raw: unknown): [string, unknown][] {
  if (Array.isArray(raw)) {
    const out: [string, unknown][] = [];
    for (let i = 0; i + 1 < raw.length; i += 2) out.push([String(raw[i]), raw[i + 1]]);
    return out;
  }
  return typeof raw === "object" && raw !== null ? Object.entries(raw) : [];
}

/** Звуки комнаты в порядке добавления. */
export async function listRoomSounds(code: string): Promise<RoomSound[]> {
  const rows = fields(await getRedisRaw().hgetall(listKey(code)));
  return rows
    .map(([id, raw]) => ({ id, s: decode(raw) }))
    .filter((x): x is { id: string; s: StoredSound } => x.s !== null)
    .sort((a, b) => a.s.at - b.s.at)
    .map(({ id, s }) => ({ id, name: s.name, by: s.by }));
}

/**
 * Добавить звук. "limit" — в комнате уже SOUND_MAX_PER_ROOM других звуков. Тот же
 * файл ещё раз — просто продлевает срок и ничего не меняет (название — первое).
 */
export async function addRoomSound(
  code: string,
  by: string,
  up: SoundUpload,
  now = Date.now(),
): Promise<RoomSound | "limit"> {
  const redis = getRedisRaw();
  const id = customSoundId(up.data);
  const exists = await redis.hexists(listKey(code), id);
  if (!exists && (await redis.hlen(listKey(code))) >= SOUND_MAX_PER_ROOM) return "limit";
  const stored: StoredSound = { name: up.name, by, mime: up.mime, at: now };
  const p = redis.pipeline();
  p.set(fileKey(code, id), up.data.toString("base64"), { ex: ROOM_STATE_TTL_SECONDS });
  if (!exists) p.hset(listKey(code), { [id]: JSON.stringify(stored) });
  p.expire(listKey(code), ROOM_STATE_TTL_SECONDS);
  await p.exec();
  if (exists) {
    const cur = decode(await redis.hget(listKey(code), id));
    return { id, name: cur?.name ?? up.name, by: cur?.by ?? by };
  }
  return { id, name: up.name, by };
}

/** Файл звука и его тип; нет — null. */
export async function getRoomSoundFile(code: string, id: string): Promise<{ mime: SoundMime; data: Buffer } | null> {
  const redis = getRedisRaw();
  const [file, meta] = await Promise.all([redis.get(fileKey(code, id)), redis.hget(listKey(code), id)]);
  const m = decode(meta);
  if (typeof file !== "string" || !m) return null;
  return { mime: m.mime, data: Buffer.from(file, "base64") };
}

/** Убрать звук. false — его нет или убирать может только добавивший или хост. */
export async function removeRoomSound(
  code: string,
  id: string,
  who: { identity: string; isHost: boolean },
): Promise<"ok" | "none" | "denied"> {
  const redis = getRedisRaw();
  const m = decode(await redis.hget(listKey(code), id));
  if (!m) return "none";
  if (m.by !== who.identity && !who.isHost) return "denied";
  const p = redis.pipeline();
  p.hdel(listKey(code), id);
  p.del(fileKey(code, id));
  await p.exec();
  return "ok";
}

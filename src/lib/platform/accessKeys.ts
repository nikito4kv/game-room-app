// ВАЖНО: только сервер. Ключи клубов и коды на создание комнат (А6).
//
//   gr:key:<id>          STRING JSON AccessKey
//   gr:keyhash:<sha256>  STRING id — поиск ключа по секрету (сам секрет не храним)
//   gr:keys              SET    все id — список для админки
//
// Секрет вида GR-XXXX-XXXX-XXXX показывается один раз при выпуске. Алфавит без
// похожих символов (нет 0/O, 1/I/L) — ключ диктуют по телефону.
import { createHash, randomBytes, randomInt } from "node:crypto";
import {
  ACCESS_KEY_TYPES,
  MAX_PARTICIPANTS_HARD,
  type AccessKey,
  type AccessKeyCreateRequest,
  type AccessKeyType,
} from "@/lib/api/platform";
import { getRedisRaw } from "@/lib/redis";
import { CAS_STRING_LUA } from "./scripts";

export const KEY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const GROUPS = 3;
const GROUP_LEN = 4;
const keyKey = (id: string) => `gr:key:${id}`;
const hashKey = (hash: string) => `gr:keyhash:${hash}`;
const INDEX = "gr:keys";
const LABEL_MAX = 40;
const REF_MAX = 200;
const MAX_USES_MAX = 100_000;

export function generateKeySecret(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let s = "";
    for (let i = 0; i < GROUP_LEN; i++) s += KEY_ALPHABET[randomInt(KEY_ALPHABET.length)];
    groups.push(s);
  }
  return `GR-${groups.join("-")}`;
}

/**
 * Секрет в каноническом виде GR-XXXX-XXXX-XXXX: регистр, пробелы и дефисы при
 * вводе не важны. Символы вне алфавита делают ключ неверным. null — не ключ.
 */
export function normalizeKeySecret(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.toUpperCase().replace(/[\s‐-―-]/g, "");
  if (s.startsWith("GR")) s = s.slice(2);
  if (s.length !== GROUPS * GROUP_LEN) return null;
  for (const ch of s) if (!KEY_ALPHABET.includes(ch)) return null;
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) groups.push(s.slice(g * GROUP_LEN, (g + 1) * GROUP_LEN));
  return `GR-${groups.join("-")}`;
}

export const hashKeySecret = (canonical: string) => createHash("sha256").update(canonical).digest("hex");

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** Проверка тела выпуска ключа (POST /api/internal/keys). */
export function validateKeyCreate(raw: unknown, now: Date = new Date()): { ok: true; value: AccessKeyCreateRequest } | { ok: false; message: string } {
  if (!isRecord(raw)) return { ok: false, message: "Нет данных ключа" };
  const type = (Object.keys(ACCESS_KEY_TYPES) as AccessKeyType[]).find((t) => t === raw.type);
  if (!type) return { ok: false, message: "Тип ключа — club, pass или gift" };
  const label = typeof raw.label === "string" ? raw.label.trim() : "";
  if (!label || [...label].length > LABEL_MAX) return { ok: false, message: `Название — от 1 до ${LABEL_MAX} символов` };
  let color: string | null = null;
  if (raw.color !== null && raw.color !== undefined && raw.color !== "") {
    if (typeof raw.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(raw.color)) {
      return { ok: false, message: "Цвет — в виде #RRGGBB" };
    }
    color = raw.color.toLowerCase();
  }
  let maxParticipants: number | null = null;
  if (raw.maxParticipants !== null && raw.maxParticipants !== undefined) {
    const n = raw.maxParticipants;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 2 || n > MAX_PARTICIPANTS_HARD) {
      return { ok: false, message: `Людей в комнате — от 2 до ${MAX_PARTICIPANTS_HARD}` };
    }
    maxParticipants = n;
  }
  let expiresAt: string | null = null;
  if (raw.expiresAt !== null && raw.expiresAt !== undefined && raw.expiresAt !== "") {
    const t = typeof raw.expiresAt === "string" ? Date.parse(raw.expiresAt) : NaN;
    if (!Number.isFinite(t)) return { ok: false, message: "Неверный срок действия" };
    if (t <= now.getTime()) return { ok: false, message: "Срок действия уже прошёл" };
    expiresAt = new Date(t).toISOString();
  }
  let maxUses: number | null = null;
  if (raw.maxUses !== null && raw.maxUses !== undefined) {
    const n = raw.maxUses;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > MAX_USES_MAX) {
      return { ok: false, message: `Число использований — от 1 до ${MAX_USES_MAX} или без ограничения` };
    }
    maxUses = n;
  }
  const ref = typeof raw.ref === "string" && raw.ref.trim() ? raw.ref.trim().slice(0, REF_MAX) : null;
  return { ok: true, value: { type, label, color, maxParticipants, expiresAt, maxUses, ref } };
}

function parseKey(raw: unknown): AccessKey | null {
  if (typeof raw !== "string") return null;
  try {
    const o = JSON.parse(raw) as AccessKey;
    return o && typeof o.id === "string" && typeof o.label === "string" ? o : null;
  } catch {
    return null;
  }
}

/** Выпустить ключ. Секрет возвращается один раз и больше нигде не хранится. */
export async function createAccessKey(
  req: AccessKeyCreateRequest,
  now: Date = new Date(),
): Promise<{ key: AccessKey; secret: string }> {
  const redis = getRedisRaw();
  for (let attempt = 0; attempt < 5; attempt++) {
    const secret = generateKeySecret();
    const key: AccessKey = {
      ...req,
      id: randomBytes(9).toString("base64url"),
      uses: 0,
      revoked: false,
      createdAt: now.toISOString(),
      lastUsedAt: null,
    };
    // Совпадение секретов (31¹² вариантов) почти невозможно, но NX его исключает.
    const reserved = await redis.set(hashKey(hashKeySecret(secret)), key.id, { nx: true });
    if (reserved === null) continue;
    const p = redis.pipeline();
    p.set(keyKey(key.id), JSON.stringify(key));
    p.sadd(INDEX, key.id);
    await p.exec();
    return { key, secret };
  }
  throw new Error("key secret collision");
}

export async function loadAccessKey(id: string): Promise<AccessKey | null> {
  if (!/^[\w-]{4,40}$/.test(id)) return null;
  return parseKey(await getRedisRaw().get(keyKey(id)));
}

export async function listAccessKeys(): Promise<AccessKey[]> {
  const redis = getRedisRaw();
  const ids = ((await redis.smembers(INDEX)) as unknown[]).map(String);
  if (ids.length === 0) return [];
  const raws = (await redis.mget(...ids.map(keyKey))) as unknown[];
  return raws
    .map(parseKey)
    .filter((k): k is AccessKey => k !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export type KeyRefusal = "not_found" | "revoked" | "expired" | "used_up";

/** Почему ключ сейчас не годится; null — годится. */
export function keyRefusal(key: AccessKey, now: Date = new Date()): KeyRefusal | null {
  if (key.revoked) return "revoked";
  if (key.expiresAt && Date.parse(key.expiresAt) <= now.getTime()) return "expired";
  if (key.maxUses !== null && key.uses >= key.maxUses) return "used_up";
  return null;
}

export const KEY_REFUSAL_TEXT: Record<KeyRefusal, string> = {
  not_found: "Такого ключа нет. Проверьте, что он введён без ошибок",
  revoked: "Этот ключ отозван. Обратитесь к тому, кто его выдал",
  expired: "Срок действия ключа закончился",
  used_up: "Ключ уже использован максимальное число раз",
};

/** Ключ по секрету без списания. */
export async function validateKeySecret(
  secret: unknown,
  now: Date = new Date(),
): Promise<{ ok: true; key: AccessKey } | { ok: false; reason: KeyRefusal }> {
  const canonical = normalizeKeySecret(secret);
  if (!canonical) return { ok: false, reason: "not_found" };
  const id = await getRedisRaw().get(hashKey(hashKeySecret(canonical)));
  const key = typeof id === "string" ? await loadAccessKey(id) : null;
  if (!key) return { ok: false, reason: "not_found" };
  const refusal = keyRefusal(key, now);
  return refusal ? { ok: false, reason: refusal } : { ok: true, key };
}

/**
 * Списать одно использование — атомарно (сравнение-и-замена): два одновременных
 * создания по ключу с maxUses: 1 не пройдут оба. Перепроверяет отзыв и срок.
 */
export async function markKeyUsed(
  id: string,
  now: Date = new Date(),
): Promise<{ ok: true; key: AccessKey } | { ok: false; reason: KeyRefusal }> {
  const redis = getRedisRaw();
  for (let attempt = 0; attempt < 5; attempt++) {
    const raw = await redis.get(keyKey(id));
    const key = parseKey(raw);
    if (!key) return { ok: false, reason: "not_found" };
    const refusal = keyRefusal(key, now);
    if (refusal) return { ok: false, reason: refusal };
    const next: AccessKey = { ...key, uses: key.uses + 1, lastUsedAt: now.toISOString() };
    const res = await redis.eval(CAS_STRING_LUA, [keyKey(id)], [String(raw), JSON.stringify(next)]);
    if (Number(res) === 1) return { ok: true, key: next };
  }
  throw new Error("key use conflict");
}

/** Отозвать ключ. null — ключа нет. */
export async function revokeAccessKey(id: string): Promise<AccessKey | null> {
  const redis = getRedisRaw();
  for (let attempt = 0; attempt < 5; attempt++) {
    const raw = await redis.get(keyKey(id));
    const key = parseKey(raw);
    if (!key) return null;
    if (key.revoked) return key;
    const next: AccessKey = { ...key, revoked: true };
    const res = await redis.eval(CAS_STRING_LUA, [keyKey(id)], [String(raw), JSON.stringify(next)]);
    if (Number(res) === 1) return next;
  }
  throw new Error("key revoke conflict");
}

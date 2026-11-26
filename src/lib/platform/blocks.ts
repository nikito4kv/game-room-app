// ВАЖНО: только сервер. Блокировки администрации (А2): адрес или устройство.
//
//   gr:block:ip:<ip>         STRING JSON Block, TTL = срок (без TTL — бессрочно).
//                            IPv4 — сам адрес, IPv6 — сеть /64 («a:b:c:d::/64»):
//                            у одного абонента обычно целая /64, адрес внутри он
//                            меняет сам, так что блок по одному адресу IPv6 бесполезен.
//   gr:block:dev:<identity>  STRING JSON Block
//   gr:ipof:<CODE>:<identity> STRING IP участника при последнем входе (48 ч) — чтобы
//                            заблокировать адрес нарушителя, не показывая его админке.
//
// Проверяются при входе (/api/token) и создании комнаты (/api/rooms). Список для
// админки — SCAN по префиксу: блокировок единицы-десятки, отдельный индекс не нужен.
import { ADMIN_REASONS, type AdminReason, type Block, type BlockKind } from "@/lib/api/platform";
import { getRedisRaw } from "@/lib/redis";

const PREFIX = "gr:block:";
const kindPart: Record<BlockKind, string> = { ip: "ip", device: "dev" };
export const blockKey = (kind: BlockKind, value: string) => `${PREFIX}${kindPart[kind]}:${value}`;
const ipOfKey = (code: string, identity: string) => `gr:ipof:${code}:${identity}`;

/** Самая долгая блокировка со сроком — год; дальше — «бессрочно» (minutes: null). */
export const BLOCK_MINUTES_MAX = 365 * 24 * 60;
/** Сколько сайт помнит IP участника комнаты (для блока «по участнику»). */
export const IP_OF_TTL_SEC = 48 * 60 * 60;
const NOTE_MAX = 300;
const VALUE_MAX = 100;

export type BlockInput = {
  kind: BlockKind;
  /** Нормализованное значение (IPv4, IPv6-сеть /64 или identity); "" — берётся у участника. */
  value: string;
  reason: AdminReason;
  note: string;
  minutes: number | null;
  fromParticipant?: { code: string; identity: string };
};

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

// ── Адреса ───────────────────────────────────────────────────────────────────

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function ipv4(raw: string): string | null {
  const m = IPV4.exec(raw);
  if (!m || m.slice(1).some((x) => Number(x) > 255)) return null;
  return m.slice(1).map(Number).join(".");
}

/** Канонический IPv6 (как его пишет URL: нижний регистр, сжатые нули); null — не IPv6. */
function canonicalIPv6(raw: string): string | null {
  if (!raw.includes(":") || !/^[0-9a-fA-F:.]+$/.test(raw)) return null;
  try {
    const host = new URL(`http://[${raw}]`).hostname;
    return host.replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
}

/** Все 8 групп IPv6 (без сжатия) из канонической записи. */
function expandIPv6(canonical: string): string[] {
  const [left, right] = canonical.includes("::") ? canonical.split("::") : [canonical, null];
  const l = left ? left.split(":") : [];
  const r = right ? right.split(":") : [];
  const zeros = right === null ? [] : Array<string>(8 - l.length - r.length).fill("0");
  return [...l, ...zeros, ...r];
}

export type NormalizedIp = { v: 4 | 6; ip: string };

/**
 * Адрес в каноническом виде. IPv4-в-IPv6 (::ffff:1.2.3.4 — так его иногда видит
 * Node) — это IPv4. null — не адрес.
 */
export function normalizeIp(raw: string): NormalizedIp | null {
  const s = raw.trim().toLowerCase();
  const v4 = ipv4(s);
  if (v4) return { v: 4, ip: v4 };
  const v6 = canonicalIPv6(s);
  if (!v6) return null;
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v6);
  if (mapped) {
    const hi = parseInt(mapped[1]!, 16);
    const lo = parseInt(mapped[2]!, 16);
    return { v: 4, ip: [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".") };
  }
  return { v: 6, ip: v6 };
}

/** Чем блокируется адрес: IPv4 — им самим, IPv6 — своей сетью /64. */
export function ipBlockValue(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\/64$/, "");
  const n = normalizeIp(s);
  if (!n) return null;
  if (n.v === 4) return n.ip;
  const prefix = expandIPv6(n.ip).slice(0, 4);
  return `${canonicalIPv6(`${prefix.join(":")}::`)}/64`;
}

// ── Проверка входа ───────────────────────────────────────────────────────────

const CODE_RE = /^[A-Z0-9]{4,12}$/;
const IDENTITY_RE = /^u_[\w-]{4,64}$/;

/** Проверка тела POST /api/internal/blocks. */
export function validateBlockInput(raw: unknown): { ok: true; value: BlockInput } | { ok: false; message: string } {
  if (!isRecord(raw)) return { ok: false, message: "Нет данных блокировки" };
  const kind = (["ip", "device"] as const).find((k) => k === raw.kind);
  if (!kind) return { ok: false, message: "kind — ip или device" };
  const rawValue = typeof raw.value === "string" ? raw.value.trim() : "";
  let value = "";
  let fromParticipant: BlockInput["fromParticipant"];
  if (kind === "ip" && !rawValue && isRecord(raw.fromParticipant)) {
    const code = typeof raw.fromParticipant.code === "string" ? raw.fromParticipant.code.trim().toUpperCase() : "";
    const identity = typeof raw.fromParticipant.identity === "string" ? raw.fromParticipant.identity.trim() : "";
    if (!CODE_RE.test(code) || !IDENTITY_RE.test(identity)) {
      return { ok: false, message: "fromParticipant — код комнаты и identity участника вида u_…" };
    }
    fromParticipant = { code, identity };
  } else if (kind === "ip") {
    const v = rawValue.length <= VALUE_MAX ? ipBlockValue(rawValue) : null;
    if (!v) return { ok: false, message: "Неверный IP-адрес" };
    value = v;
  } else {
    if (!IDENTITY_RE.test(rawValue)) return { ok: false, message: "Устройство — identity участника вида u_…" };
    value = rawValue;
  }
  const reason = (Object.keys(ADMIN_REASONS) as AdminReason[]).find((r) => r === raw.reason);
  if (!reason) return { ok: false, message: "Нужна причина из списка" };
  const note = typeof raw.note === "string" ? raw.note.trim().slice(0, NOTE_MAX) : "";
  let minutes: number | null = null;
  if (raw.minutes !== null && raw.minutes !== undefined) {
    if (typeof raw.minutes !== "number" || !Number.isInteger(raw.minutes) || raw.minutes < 1 || raw.minutes > BLOCK_MINUTES_MAX) {
      return { ok: false, message: `Срок — целое число минут от 1 до ${BLOCK_MINUTES_MAX} или null (бессрочно)` };
    }
    minutes = raw.minutes;
  }
  return { ok: true, value: { kind, value, reason, note, minutes, ...(fromParticipant ? { fromParticipant } : {}) } };
}

function parseBlock(raw: unknown): Block | null {
  if (typeof raw !== "string") return null;
  try {
    const o = JSON.parse(raw) as Block;
    return o && typeof o.value === "string" && (o.kind === "ip" || o.kind === "device") ? o : null;
  } catch {
    return null;
  }
}

// ── IP участника ─────────────────────────────────────────────────────────────

/** Запомнить IP участника при успешном входе. Не бросает. */
export async function rememberParticipantIp(code: string, identity: string, ip: string): Promise<void> {
  if (!ip || ip === "local") return;
  try {
    await getRedisRaw().set(ipOfKey(code, identity), ip, { ex: IP_OF_TTL_SEC });
  } catch (err) {
    console.error("ip remember failed", err);
  }
}

/** Подпись блокировки «по участнику»: сам адрес админке не показываем. */
export const participantBlockLabel = (code: string, identity: string) => `участник ${identity} в ${code}`;

// ── Хранение ─────────────────────────────────────────────────────────────────

export type CreateBlockResult = { ok: true; block: Block } | { ok: false; reason: "ip_unknown" };

export async function createBlock(input: BlockInput, now: Date = new Date()): Promise<CreateBlockResult> {
  let keyValue = input.value;
  let shown = input.value;
  if (input.fromParticipant) {
    const { code, identity } = input.fromParticipant;
    const ip = await getRedisRaw().get(ipOfKey(code, identity));
    const v = typeof ip === "string" ? ipBlockValue(ip) : null;
    if (!v) return { ok: false, reason: "ip_unknown" };
    keyValue = v;
    shown = participantBlockLabel(code, identity);
  }
  const block: Block = {
    kind: input.kind,
    value: shown,
    reason: input.reason,
    note: input.note,
    createdAt: now.toISOString(),
    until: input.minutes === null ? null : new Date(now.getTime() + input.minutes * 60_000).toISOString(),
  };
  const key = blockKey(input.kind, keyValue);
  if (input.minutes === null) await getRedisRaw().set(key, JSON.stringify(block));
  else await getRedisRaw().set(key, JSON.stringify(block), { ex: input.minutes * 60 });
  return { ok: true, block };
}

/** Все блокировки вместе с ключами (ключ IP-блока «по участнику» содержит адрес — наружу не отдаём). */
async function scanBlocks(): Promise<Array<{ key: string; block: Block }>> {
  const redis = getRedisRaw();
  const keys: string[] = [];
  let cursor = "0";
  for (let i = 0; i < 100; i++) {
    const [next, batch] = (await redis.scan(cursor, { match: `${PREFIX}*`, count: 500 })) as [
      string | number,
      string[],
    ];
    keys.push(...batch.map(String));
    cursor = String(next);
    if (cursor === "0") break;
  }
  if (keys.length === 0) return [];
  const values = (await redis.mget(...keys)) as unknown[];
  return keys.flatMap((key, i) => {
    const block = parseBlock(values[i]);
    return block ? [{ key, block }] : [];
  });
}

/**
 * Снять блокировку. value — как в списке (адрес, сеть /64, identity или подпись
 * «участник … в …»). true — была.
 */
export async function removeBlock(kind: BlockKind, value: string): Promise<boolean> {
  const redis = getRedisRaw();
  const direct = kind === "ip" ? ipBlockValue(value) : value;
  if (direct && Number(await redis.del(blockKey(kind, direct))) > 0) return true;
  const found = (await scanBlocks()).find((b) => b.block.kind === kind && b.block.value === value);
  return found ? Number(await redis.del(found.key)) > 0 : false;
}

/** Все действующие блокировки (новые первыми). */
export async function listBlocks(): Promise<Block[]> {
  return (await scanBlocks()).map((b) => b.block).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Блокировка, под которую попадает вход: по адресу (IPv6 — по его сети /64) и
 * (если известно) по устройству. null — не заблокирован. Redis недоступен — null
 * (fail-open: вход и так упадёт на состоянии комнаты, а блокировки — не
 * единственная защита).
 */
export async function findBlock(ip: string | null, identity: string | null): Promise<Block | null> {
  const keys: string[] = [];
  const v = ip && ip !== "local" ? ipBlockValue(ip) : null;
  if (v) keys.push(blockKey("ip", v));
  if (identity) keys.push(blockKey("device", identity));
  if (keys.length === 0) return null;
  try {
    const values = (await getRedisRaw().mget(...keys)) as unknown[];
    for (const val of values) {
      const b = parseBlock(val);
      if (b) return b;
    }
    return null;
  } catch (err) {
    console.error("block check failed", err);
    return null;
  }
}

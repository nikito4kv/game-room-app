// ВАЖНО: только сервер. Жалобы из комнат (А2).
//
//   gr:report:<id>  STRING JSON StoredReport (со снимком чата), живёт 180 дней
//   gr:reports      ZSET   id → время создания (мс): очередь для админки
//
// Снимок чата кладём в саму жалобу: через сутки комната и её чат исчезнут, а
// основание для решения должно остаться. Голос не пишем никогда.
import {
  REPORT_REASONS,
  type ReportReason,
  type ReportStatus,
  type StoredReport,
} from "@/lib/api/platform";
import type { ChatMessage } from "@/lib/api/contract";
import { getRedisRaw } from "@/lib/redis";
import { randomBytes } from "node:crypto";
import { CAS_STRING_LUA } from "./scripts";
import { newestMembers } from "./zsetPage";

const reportKey = (id: string) => `gr:report:${id}`;
const INDEX = "gr:reports";
export const REPORT_TTL_SEC = 180 * 24 * 60 * 60;
/** Сколько последних сообщений чата кладём в жалобу. */
export const REPORT_CHAT_SNAPSHOT = 30;
export const REPORT_NOTE_MAX = 500;
/** Очередь не растёт без границ: дальше самые старые выпадают из индекса. */
export const REPORTS_INDEX_MAX = 5000;
const INDEX_MAX = REPORTS_INDEX_MAX;

export const isReportReason = (x: unknown): x is ReportReason =>
  typeof x === "string" && Object.hasOwn(REPORT_REASONS, x);

export function chatSnapshot(messages: readonly ChatMessage[]): StoredReport["chatSnapshot"] {
  return messages.slice(-REPORT_CHAT_SNAPSHOT).map((m) => ({ name: m.from.name, text: m.text, at: m.ts }));
}

function parseReport(raw: unknown): StoredReport | null {
  if (typeof raw !== "string") return null;
  try {
    const o = JSON.parse(raw) as StoredReport;
    return o && typeof o.id === "string" && typeof o.code === "string" ? o : null;
  } catch {
    return null;
  }
}

/** Потолок жалоб за сутки (UTC) на весь сайт: залив с меняющихся адресов не утопит очередь. */
export const MAX_REPORTS_PER_DAY = 500;
const dayKey = (now: Date) => `gr:reports:day:${now.toISOString().slice(0, 10)}`;
const DAY_TTL_SEC = 3 * 24 * 60 * 60;

export type CreateReportResult = { ok: true; report: StoredReport } | { ok: false; reason: "daily_cap" };

export async function createReport(
  input: Omit<StoredReport, "id" | "createdAt" | "status" | "resolution">,
  now: Date = new Date(),
): Promise<CreateReportResult> {
  const redis = getRedisRaw();
  const day = dayKey(now);
  const count = Number(await redis.incr(day));
  if (count === 1) await redis.expire(day, DAY_TTL_SEC);
  if (count > MAX_REPORTS_PER_DAY) return { ok: false, reason: "daily_cap" };

  const report: StoredReport = {
    ...input,
    id: randomBytes(9).toString("base64url"),
    createdAt: now.toISOString(),
    status: "new",
    resolution: null,
  };
  const p = redis.pipeline();
  p.set(reportKey(report.id), JSON.stringify(report), { ex: REPORT_TTL_SEC });
  p.zadd(INDEX, { score: now.getTime(), member: report.id });
  // Из индекса — жалобы, чей срок уже вышел (сами записи истекли по TTL).
  p.zremrangebyscore(INDEX, 0, now.getTime() - REPORT_TTL_SEC * 1000);
  await p.exec();
  await trimIndex();
  return { ok: true, report };
}

/** Очередь длиннее INDEX_MAX — самые старые выпадают вместе со своими записями. */
async function trimIndex(): Promise<void> {
  const redis = getRedisRaw();
  const size = Number(await redis.zcard(INDEX));
  if (size <= INDEX_MAX) return;
  const doomed = ((await redis.zrange(INDEX, 0, size - INDEX_MAX - 1)) as unknown[]).map(String);
  if (doomed.length === 0) return;
  const p = redis.pipeline();
  p.del(...doomed.map(reportKey));
  p.zrem(INDEX, ...doomed);
  await p.exec();
}

export async function loadReport(id: string): Promise<StoredReport | null> {
  return parseReport(await getRedisRaw().get(reportKey(id)));
}

/** Жалоб на странице — не больше. */
export const REPORTS_PAGE_MAX = 100;
const SCAN_BATCH = 100;

/**
 * Жалобы, новые первыми, страницами: cursor — сколько записей индекса уже
 * просмотрено (null/"0" — с начала), nextCursor — откуда продолжать (null — всё).
 * status "new" — только нерешённые; code — только по одной комнате.
 */
export async function listReports(
  opts: { status?: "new" | "all"; code?: string; limit?: number; cursor?: string | null } = {},
): Promise<{ reports: StoredReport[]; nextCursor: string | null }> {
  const redis = getRedisRaw();
  const limit = Math.min(Math.max(1, opts.limit ?? REPORTS_PAGE_MAX), REPORTS_PAGE_MAX);
  let offset = Math.max(0, Math.floor(Number(opts.cursor)) || 0);
  const reports: StoredReport[] = [];
  // Не больше одного прохода по всей очереди за запрос.
  for (let scanned = 0; scanned < INDEX_MAX && reports.length < limit; scanned += SCAN_BATCH) {
    const ids = await newestMembers(INDEX, offset, SCAN_BATCH);
    if (ids.length === 0) return { reports, nextCursor: null };
    const raws = (await redis.mget(...ids.map(reportKey))) as unknown[];
    for (let i = 0; i < ids.length; i++) {
      offset++;
      const r = parseReport(raws[i]);
      if (!r) continue;
      if (opts.status === "new" && r.status !== "new") continue;
      if (opts.code && r.code !== opts.code) continue;
      reports.push(r);
      if (reports.length >= limit) break;
    }
    if (ids.length < SCAN_BATCH && reports.length < limit) return { reports, nextCursor: null };
  }
  return { reports, nextCursor: String(offset) };
}

/** Решение по жалобе. null — жалобы нет. */
export async function updateReport(
  id: string,
  status: ReportStatus,
  resolution: string | null,
): Promise<StoredReport | null> {
  const redis = getRedisRaw();
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await redis.get(reportKey(id));
    const current = parseReport(raw);
    if (!current) return null;
    const next: StoredReport = { ...current, status, resolution };
    const res = await redis.eval(CAS_STRING_LUA, [reportKey(id)], [String(raw), JSON.stringify(next)]);
    if (Number(res) === 1) return next;
  }
  throw new Error("report update conflict");
}

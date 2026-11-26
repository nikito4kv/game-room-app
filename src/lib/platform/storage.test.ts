// Хранилища платформы на фейковом Redis: блокировки, ключи клубов, заявки-диалоги,
// поток событий, жалобы.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeRedis } from "@/lib/server/testFakes";

const h = vi.hoisted(() => ({ redis: null as unknown }));
vi.mock("@/lib/redis", () => ({ getRedis: () => h.redis, getRedisRaw: () => h.redis }));

import { EVENTS_STREAM } from "@/lib/api/platform";
import { LEADS_KEY, type StoredLead, type ValidLeadCreate } from "@/lib/leads";
import {
  createBlock,
  findBlock,
  ipBlockValue,
  listBlocks,
  rememberParticipantIp,
  removeBlock,
  validateBlockInput,
} from "./blocks";
import {
  createAccessKey,
  generateKeySecret,
  listAccessKeys,
  markKeyUsed,
  normalizeKeySecret,
  revokeAccessKey,
  validateKeyCreate,
  validateKeySecret,
} from "./accessKeys";
import {
  LEAD_RETENTION_DAYS,
  addUserMessage,
  createLeadThread,
  listThreads,
  loadThread,
  migrateLegacyLeads,
  purgeOldThreads,
  readThreadForUser,
  setThreadStatus,
  statusBatch,
  teamReply,
} from "./leadThreads";
import { EVENTS_RETENTION_DAYS, emitEvent, readEvents, settleEvents, trimOldEvents } from "./events";
import { REPORTS_INDEX_MAX, chatSnapshot, createReport, listReports, updateReport } from "./reports";

let redis: FakeRedis;
beforeEach(() => {
  redis = new FakeRedis();
  h.redis = redis;
});
afterEach(() => vi.useRealTimers());

const T0 = new Date("2026-10-06T10:00:00Z");

describe("блокировки", () => {
  it("со сроком истекают, бессрочные — нет; список и снятие", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    await createBlock({ kind: "ip", value: "1.2.3.4", reason: "spam", note: "", minutes: 10 });
    await createBlock({ kind: "device", value: "u_abcdef", reason: "abuse", note: "x", minutes: null });
    expect((await findBlock("1.2.3.4", null))?.until).toBe("2026-10-06T10:10:00.000Z");
    expect((await findBlock("9.9.9.9", "u_abcdef"))?.kind).toBe("device");
    expect(await findBlock("9.9.9.9", "u_other")).toBeNull();
    expect((await listBlocks()).length).toBe(2);
    vi.setSystemTime(new Date(T0.getTime() + 11 * 60_000));
    expect(await findBlock("1.2.3.4", null)).toBeNull();
    expect(await removeBlock("device", "u_abcdef")).toBe(true);
    expect(await listBlocks()).toEqual([]);
  });

  it("IP нормализуется; IPv6 блокируется сетью /64, вход проверяется по префиксу", async () => {
    expect(ipBlockValue(" 010.1.2.3 ")).toBe("10.1.2.3");
    expect(ipBlockValue("1.2.3.256")).toBeNull();
    expect(ipBlockValue("::FFFF:1.2.3.4")).toBe("1.2.3.4");
    expect(ipBlockValue("2001:DB8:0:0:1::5")).toBe("2001:db8::/64");
    expect(ipBlockValue("2001:db8:aa:bb:cc::1")).toBe("2001:db8:aa:bb::/64");
    expect(ipBlockValue("2001:db8:aa:bb::/64")).toBe("2001:db8:aa:bb::/64");
    expect(ipBlockValue("evil")).toBeNull();
    const v = validateBlockInput({ kind: "ip", value: "2001:DB8:AA:BB::1", reason: "spam", minutes: null });
    expect(v.ok && v.value.value).toBe("2001:db8:aa:bb::/64");
    await createBlock(v.ok ? v.value : (null as never));
    expect((await findBlock("2001:db8:aa:bb:ffff::9", null))?.value).toBe("2001:db8:aa:bb::/64");
    expect(await findBlock("2001:db8:aa:bc::1", null)).toBeNull();
    expect(await removeBlock("ip", "2001:DB8:AA:BB::7")).toBe(true);
    expect(await listBlocks()).toEqual([]);
  });

  it("блок «по участнику»: адрес берётся из памяти входа и не показывается", async () => {
    const input = validateBlockInput({
      kind: "ip", value: "", fromParticipant: { code: "abcd", identity: "u_abcdef" }, reason: "abuse", minutes: 60,
    });
    expect(input.ok).toBe(true);
    if (!input.ok) return;
    expect(await createBlock(input.value)).toEqual({ ok: false, reason: "ip_unknown" });
    await rememberParticipantIp("ABCD", "u_abcdef", "5.6.7.8");
    const res = await createBlock(input.value);
    expect(res.ok && res.block.value).toBe("участник u_abcdef в ABCD");
    expect(JSON.stringify(res)).not.toContain("5.6.7.8");
    expect(JSON.stringify(await listBlocks())).not.toContain("5.6.7.8");
    expect((await findBlock("5.6.7.8", null))?.reason).toBe("abuse");
    expect(await removeBlock("ip", "участник u_abcdef в ABCD")).toBe(true);
    expect(await findBlock("5.6.7.8", null)).toBeNull();
  });

  it("проверка входа: причина обязательна, формат значения", () => {
    expect(validateBlockInput({ kind: "ip", value: "1.2.3.4", reason: "spam", minutes: null }).ok).toBe(true);
    expect(validateBlockInput({ kind: "ip", value: "1.2.3.4", minutes: null }).ok).toBe(false);
    expect(validateBlockInput({ kind: "ip", value: "evil*", reason: "spam", minutes: null }).ok).toBe(false);
    expect(validateBlockInput({ kind: "device", value: "nick", reason: "spam", minutes: null }).ok).toBe(false);
    expect(validateBlockInput({ kind: "ip", value: "::1", reason: "spam", minutes: 0 }).ok).toBe(false);
  });
});

describe("ключи клубов", () => {
  const req = { type: "club", label: "Клуб «Арена»", color: "#FF8800", maxParticipants: 20, expiresAt: null, maxUses: 2, ref: "club:1" };

  it("секрет: формат, нормализация ввода", () => {
    const s = generateKeySecret();
    expect(s).toMatch(/^GR-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(s).not.toMatch(/[01OIL]/);
    expect(normalizeKeySecret(s.toLowerCase().replace(/-/g, " "))).toBe(s);
    expect(normalizeKeySecret("GR-0000-0000-0000")).toBeNull();
    expect(normalizeKeySecret("abc")).toBeNull();
  });

  it("выпуск хранит только хэш; использования до maxUses", async () => {
    const v = validateKeyCreate(req, T0);
    expect(v.ok).toBe(true);
    const { key, secret } = await createAccessKey(v.ok ? v.value : (null as never), T0);
    expect(key.color).toBe("#ff8800");
    expect(JSON.stringify([...redis.keys()])).not.toContain(secret);
    expect((await validateKeySecret(secret)).ok).toBe(true);
    expect((await markKeyUsed(key.id)).ok).toBe(true);
    expect((await markKeyUsed(key.id)).ok).toBe(true);
    expect(await markKeyUsed(key.id)).toEqual({ ok: false, reason: "used_up" });
    expect(await validateKeySecret(secret)).toEqual({ ok: false, reason: "used_up" });
    expect((await listAccessKeys())[0]?.uses).toBe(2);
  });

  it("отзыв и истечение", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const v = validateKeyCreate({ ...req, maxUses: null, expiresAt: "2026-10-07T00:00:00Z" }, T0);
    const { key, secret } = await createAccessKey(v.ok ? v.value : (null as never));
    expect((await validateKeySecret(secret)).ok).toBe(true);
    vi.setSystemTime(new Date("2026-10-07T00:00:01Z"));
    expect(await validateKeySecret(secret)).toEqual({ ok: false, reason: "expired" });
    vi.setSystemTime(T0);
    await revokeAccessKey(key.id);
    expect(await markKeyUsed(key.id)).toEqual({ ok: false, reason: "revoked" });
    expect(await validateKeySecret("GR-AAAA-BBBB-CCCC")).toEqual({ ok: false, reason: "not_found" });
  });

  it("проверка выпуска: границы", () => {
    expect(validateKeyCreate({ ...req, maxParticipants: 26 }).ok).toBe(false);
    expect(validateKeyCreate({ ...req, label: "" }).ok).toBe(false);
    expect(validateKeyCreate({ ...req, color: "red" }).ok).toBe(false);
    expect(validateKeyCreate({ ...req, expiresAt: "2020-01-01T00:00:00Z" }).ok).toBe(false);
    expect(validateKeyCreate({ ...req, type: "vip" }).ok).toBe(false);
  });
});

describe("заявки-диалоги", () => {
  const lead: ValidLeadCreate = {
    kind: "club",
    product: "club",
    name: "Арена",
    message: "Хотим попробовать",
    contact: null,
    clubName: "Арена",
    city: "Казань",
    pcCount: 30,
    source: null,
  };

  it("токен: только хэш, чужой не подходит; ответ команды → «есть ответ» до чтения", async () => {
    const created = await createLeadThread(lead, T0);
    if (!created.ok) throw new Error("not created");
    const { thread, token } = created;
    expect(JSON.stringify(await redis.get(`gr:lead:${thread.id}`))).not.toContain(token);
    expect(await readThreadForUser(thread.id, "чужой")).toBeNull();
    expect((await readThreadForUser(thread.id, token))?.hasUnread).toBe(false);

    const admin = await teamReply(thread.id, "Здравствуйте!", new Date(T0.getTime() + 1000));
    expect(admin?.status).toBe("answered");
    expect(await statusBatch([{ id: thread.id, t: token }, { id: thread.id, t: "x" }])).toEqual([
      { id: thread.id, hasUnread: true, status: "answered" },
    ]);
    const seen = await readThreadForUser(thread.id, token);
    expect(seen?.hasUnread).toBe(true);
    expect(seen?.messages.map((m) => m.from)).toEqual(["user", "team"]);
    expect((await readThreadForUser(thread.id, token))?.hasUnread).toBe(false);

    const more = await addUserMessage(thread.id, token, "Спасибо", new Date(T0.getTime() + 2000));
    expect(more.ok && more.thread.status).toBe("in_progress");
    expect((await addUserMessage(thread.id, "x", "взлом")).ok).toBe(false);
  });

  it("ящик: свежие сверху, фильтр по статусу, страницы", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const c = await createLeadThread(lead, new Date(T0.getTime() + i * 1000));
      if (c.ok) ids.push(c.thread.id);
    }
    await setThreadStatus(ids[0]!, "paying", new Date(T0.getTime() + 10_000));
    const all = await listThreads({ limit: 3 });
    expect(all.leads.map((l) => l.id)).toEqual([ids[0], ids[4], ids[3]]);
    expect(all.nextCursor).toBe("3");
    const rest = await listThreads({ limit: 3, cursor: all.nextCursor });
    expect(rest.leads.map((l) => l.id)).toEqual([ids[2], ids[1]]);
    expect(rest.nextCursor).toBeNull();
    expect((await listThreads({ status: "paying" })).leads.map((l) => l.id)).toEqual([ids[0]]);
  });

  it("суточный потолок", async () => {
    await redis.set(`gr:leads:day:${T0.toISOString().slice(0, 10)}`, "300");
    expect(await createLeadThread(lead, T0)).toEqual({ ok: false, reason: "daily_cap" });
  });

  it("перенос leads:v1 — один раз, с контактом и пометкой migrated", async () => {
    const old: StoredLead = {
      id: "old1",
      at: "2026-09-20T10:00:00.000Z",
      kind: "club_pilot",
      tier: "club",
      contact: "@arena",
      contactType: "handle",
      role: "club",
      clubName: "Арена",
      city: "Казань",
      pcCount: 40,
      note: "Позвоните",
      consent: true,
    };
    await redis.lpush(LEADS_KEY, JSON.stringify(old), "битая строка");
    expect(await migrateLegacyLeads()).toBe(1);
    expect(await migrateLegacyLeads()).toBe(0);
    const t = await loadThread("m_old1");
    expect(t).toMatchObject({ migrated: true, contact: "@arena", kind: "club", product: "club", pcCount: 40 });
    expect(t?.messages[0]?.text).toContain("Позвоните");
    // Флаг сбросили — повторный перенос не плодит дубли.
    await redis.del("gr:leads:migrated");
    expect(await migrateLegacyLeads()).toBe(0);
    // Сбой между записью заявки и индексом: следующий проход возвращает её в ящик,
    // не сдвигая порядок уже бывших там.
    await redis.zrem("gr:leads", "m_old1");
    await redis.del("gr:leads:migrated");
    expect((await listThreads()).leads).toEqual([]);
    await migrateLegacyLeads();
    expect((await listThreads()).leads.map((l) => l.id)).toEqual(["m_old1"]);
  });

  it("срок хранения: диалоги старше 12 месяцев удаляются", async () => {
    const old = await createLeadThread(lead, new Date(T0.getTime() - (LEAD_RETENTION_DAYS + 1) * 86_400_000));
    const fresh = await createLeadThread(lead, T0);
    expect(await purgeOldThreads(T0)).toBe(1);
    expect(old.ok && (await loadThread(old.thread.id))).toBeNull();
    expect(fresh.ok && (await loadThread(fresh.thread.id))?.id).toBeTruthy();
    expect(await purgeOldThreads(T0)).toBe(0); // не чаще раза в 6 часов
  });
});

describe("поток событий", () => {
  it("запись и чтение после id (исключая его), поля строками", async () => {
    await emitEvent({ t: "join_fail", code: "ABCD", reason: "BANNED" });
    await emitEvent({ t: "feature", code: "ABCD", name: "chat", identity: undefined });
    await settleEvents();
    const first = await readEvents("0", 1);
    expect(first.events).toHaveLength(1);
    expect(first.events[0]).toMatchObject({ t: "join_fail", code: "ABCD", reason: "BANNED" });
    const next = await readEvents(first.last, 100);
    expect(next.events.map((e) => e.t)).toEqual(["feature"]);
    expect(next.events[0]).not.toHaveProperty("identity");
    expect((await readEvents(next.last, 100)).last).toBeNull();
  });

  it("сбой Redis не роняет вызывающего", async () => {
    h.redis = { xadd: async () => Promise.reject(new Error("down")) };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(emitEvent({ t: "lead_msg", leadId: "x" })).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it("события старше срока стираются", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    await redis.xadd(EVENTS_STREAM, "*", { t: "lead_msg", ts: "x", leadId: "old" });
    vi.setSystemTime(new Date(T0.getTime() + (EVENTS_RETENTION_DAYS + 1) * 86_400_000));
    await redis.xadd(EVENTS_STREAM, "*", { t: "lead_msg", ts: "x", leadId: "new" });
    await trimOldEvents();
    expect((await readEvents(null, 10)).events.map((e) => (e as { leadId?: string }).leadId)).toEqual(["new"]);
  });
});

describe("жалобы", () => {
  it("снимок чата — последние 30; очередь и решение", async () => {
    const msgs = Array.from({ length: 40 }, (_, i) => ({
      id: String(i), ts: i, text: `m${i}`, from: { identity: "u_a", name: "Аня" },
    }));
    expect(chatSnapshot(msgs)).toHaveLength(30);
    expect(chatSnapshot(msgs)[0]?.text).toBe("m10");
    const created = await createReport({
      code: "ABCD", reporterIdentity: "u_a", reporterName: "Аня", targetIdentity: null, targetName: null,
      reason: "spam", note: "", chatSnapshot: [],
    });
    if (!created.ok) throw new Error("not created");
    const r = created.report;
    expect((await listReports({ status: "new" })).reports.map((x) => x.id)).toEqual([r.id]);
    await updateReport(r.id, "resolved", "закрыли комнату");
    expect((await listReports({ status: "new" })).reports).toEqual([]);
    expect((await listReports({ status: "all", code: "ABCD" })).reports[0]?.resolution).toBe("закрыли комнату");
    expect(await updateReport("nope12", "dismissed", null)).toBeNull();
  });
});

describe("жалобы: страницы, потолок, чистка", () => {
  const input = (code: string) => ({
    code, reporterIdentity: "u_a", reporterName: "Аня", targetIdentity: null, targetName: null,
    reason: "spam" as const, note: "", chatSnapshot: [],
  });

  it("страницы по 100 с курсором, новые первыми", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 130; i++) {
      const c = await createReport(input(i % 2 ? "ODDS" : "EVEN"), new Date(T0.getTime() + i * 1000));
      if (c.ok) ids.push(c.report.id);
    }
    const first = await listReports({ status: "all" });
    expect(first.reports).toHaveLength(100);
    expect(first.reports[0]?.id).toBe(ids[129]);
    expect(first.nextCursor).toBe("100");
    const second = await listReports({ status: "all", cursor: first.nextCursor });
    expect(second.reports.map((r) => r.id)).toEqual(ids.slice(0, 30).reverse());
    expect(second.nextCursor).toBeNull();
    const odds = await listReports({ status: "all", code: "ODDS", limit: 10 });
    expect(odds.reports.every((r) => r.code === "ODDS")).toBe(true);
    expect(odds.reports).toHaveLength(10);
  });

  it("очередь длиннее предела — старейшие выпадают вместе с записями", async () => {
    for (let i = 0; i < REPORTS_INDEX_MAX; i++) {
      await redis.zadd("gr:reports", { score: T0.getTime() - 1_000_000 + i, member: `old${i}` });
      if (i < 2) await redis.set(`gr:report:old${i}`, "{}");
    }
    await createReport(input("ABCD"), T0);
    expect(await redis.zcard("gr:reports")).toBe(REPORTS_INDEX_MAX);
    expect(await redis.get("gr:report:old0")).toBeNull();
    expect(await redis.get("gr:report:old1")).toBe("{}");
  });

  it("суточный потолок", async () => {
    await redis.set(`gr:reports:day:${T0.toISOString().slice(0, 10)}`, "500");
    expect(await createReport(input("ABCD"), T0)).toEqual({ ok: false, reason: "daily_cap" });
  });

  it("выпавшие из очереди (старше срока) удаляются из индекса", async () => {
    const old = await createReport(input("ABCD"), new Date(T0.getTime() - 200 * 86_400_000));
    await createReport(input("ABCD"), T0);
    expect((await listReports({ status: "all" })).reports).toHaveLength(1);
    expect(old.ok && (await redis.zrange("gr:reports", 0, -1))).not.toContain(old.ok ? old.report.id : "");
  });
});

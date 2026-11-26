// Чистые части платформы: детектор слов чата и пропуск во внутренний API.
import { afterEach, describe, expect, it } from "vitest";
import { CHAT_FLAG_EXCERPT_MAX, detectChatFlag } from "./chatFlags";
import { checkInternalAuth } from "./internalAuth";
import { validateLeadCreate } from "@/lib/leads";

describe("детектор слов чата", () => {
  it("ловит оскорбления с окончаниями, ё/е и латинскими двойниками", () => {
    expect(detectChatFlag("ты пидорас")?.category).toBe("hate");
    expect(detectChatFlag("ну ты и уёбок")?.category).toBe("abuse");
    expect(detectChatFlag("ДОЛБОЁБ")?.category).toBe("abuse");
    expect(detectChatFlag("пuдoр")?.category).toBe("hate"); // латинские u, o
    expect(detectChatFlag("х а ч")?.category).toBe("hate"); // разбит пробелами
    expect(detectChatFlag("kill yourself")?.category).toBe("abuse");
    expect(detectChatFlag("продам наркотики недорого")?.category).toBe("illegal");
  });

  it("не трогает обычные слова", () => {
    for (const ok of [
      "хачапури на ужин",
      "сделал закладку в браузере",
      "хохлома красивая",
      "жидкость для омывателя",
      "го в доту",
      "блин, опять проиграли",
      "",
    ]) {
      expect(detectChatFlag(ok)).toBeNull();
    }
  });

  it("отрывок не длиннее предела", () => {
    const long = `${"бла ".repeat(100)}мразь ${"бла ".repeat(100)}`;
    const flag = detectChatFlag(long);
    expect(flag?.match).toBe("мразь");
    expect([...(flag?.excerpt ?? "")].length).toBeLessThanOrEqual(CHAT_FLAG_EXCERPT_MAX);
    expect(flag?.excerpt).toContain("мразь");
  });
});

describe("пропуск во внутренний API", () => {
  const saved = process.env.INTERNAL_API_TOKEN;
  afterEach(() => {
    process.env.INTERNAL_API_TOKEN = saved;
  });
  const req = (token?: string) =>
    new Request("http://app.test/api/internal/live", { headers: token ? { "x-internal-token": token } : {} });

  it("без переменной (или короткой) — 503 для всех", () => {
    delete process.env.INTERNAL_API_TOKEN;
    expect(checkInternalAuth(req("anything"))?.status).toBe(503);
    process.env.INTERNAL_API_TOKEN = "short";
    expect(checkInternalAuth(req("short"))?.status).toBe(503);
  });

  it("верный токен — пропуск, неверный или пустой — 401", () => {
    process.env.INTERNAL_API_TOKEN = "t".repeat(40);
    expect(checkInternalAuth(req("t".repeat(40)))).toBeNull();
    expect(checkInternalAuth(req("t".repeat(39)))?.status).toBe(401);
    expect(checkInternalAuth(req())?.status).toBe(401);
  });
});

describe("проверка новой заявки", () => {
  const ok = { kind: "pricing", product: "pro", name: "Аня", message: "Хочу Pro", consent: true };

  it("минимальная заявка без контакта проходит", () => {
    const r = validateLeadCreate(ok);
    expect(r.ok && r.lead).toMatchObject({ contact: null, pcCount: null, name: "Аня" });
  });

  it("ошибки по полям", () => {
    const r = validateLeadCreate({ kind: "x", product: "y", name: "", message: "", consent: false, contact: "+7 999 123-45-67" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(["consent", "contact", "kind", "message", "name", "product"]);
    }
    const long = validateLeadCreate({ ...ok, message: "я".repeat(2001) });
    expect(!long.ok && long.errors.message).toBeTruthy();
  });
});

describe("nextStreamId", () => {
  it("следующий id потока без исключающего диапазона", async () => {
    const { nextStreamId } = await import("./events");
    expect(nextStreamId("1791212922466-0")).toBe("1791212922466-1");
    expect(nextStreamId("5-9")).toBe("5-10");
    expect(nextStreamId("7")).toBe("7-1");
  });
});

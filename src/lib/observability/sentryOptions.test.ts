import { afterEach, describe, it, expect, vi } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import { resolveEnvironment, scrubEvent } from "./sentryOptions";
import { hashRoomCode } from "@/lib/hash";

describe("resolveEnvironment — окружение в Sentry", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("SENTRY_ENVIRONMENT важнее NODE_ENV (пробный сервер — staging)", () => {
    vi.stubEnv("SENTRY_ENVIRONMENT", "staging");
    vi.stubEnv("NODE_ENV", "production");
    expect(resolveEnvironment()).toBe("staging");
  });

  it("на своём сервере без настройки — production из NODE_ENV, а не development", () => {
    vi.stubEnv("SENTRY_ENVIRONMENT", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(resolveEnvironment()).toBe("production");
  });

  it("переменные Vercel больше ни на что не влияют", () => {
    vi.stubEnv("SENTRY_ENVIRONMENT", "");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "preview");
    vi.stubEnv("NODE_ENV", "production");
    expect(resolveEnvironment()).toBe("production");
  });

  it("совсем пусто — development", () => {
    vi.stubEnv("SENTRY_ENVIRONMENT", "");
    vi.stubEnv("NODE_ENV", "");
    expect(resolveEnvironment()).toBe("development");
  });
});

describe("scrubEvent — скрабинг кода комнаты", () => {
  it("режет код в request.url, сохраняя хост и query", () => {
    const event = {
      request: { url: "https://app.example.com/room/ABC123?x=1" },
    } as ErrorEvent;
    expect(scrubEvent(event).request?.url).toBe(
      "https://app.example.com/room/[code]?x=1",
    );
  });

  it("режет код в заголовке Referer (утечка через headers)", () => {
    const event = {
      request: {
        url: "https://app/api/token",
        headers: { Referer: "https://app/room/SECRET", "X-Other": "keep" },
      },
    } as unknown as ErrorEvent;
    const out = scrubEvent(event);
    expect(out.request?.headers?.Referer).toBe("https://app/room/[code]");
    expect(out.request?.headers?.["X-Other"]).toBe("keep");
  });

  it("режет код в сообщении и в тексте исключения", () => {
    const event = {
      message: "failed at /room/ABC123",
      exception: { values: [{ value: "join /room/ABC123 failed" }] },
    } as unknown as ErrorEvent;
    const out = scrubEvent(event);
    expect(out.message).toBe("failed at /room/[code]");
    expect(out.exception?.values?.[0].value).toBe("join /room/[code] failed");
  });

  it("режет код во всех строковых полях хлебных крошек", () => {
    const event = {
      breadcrumbs: [
        { message: "navigated to /room/AAA", data: { url: "/room/AAA/chat" } },
        { data: { from: "/room/AAA", to: "/room/BBB", note: "/room/CCC" } },
        { data: { foo: "bar" } },
      ],
    } as unknown as ErrorEvent;
    const out = scrubEvent(event);
    expect(out.breadcrumbs?.[0].message).toBe("navigated to /room/[code]");
    expect(out.breadcrumbs?.[0].data?.url).toBe("/room/[code]/chat");
    expect(out.breadcrumbs?.[1].data?.from).toBe("/room/[code]");
    expect(out.breadcrumbs?.[1].data?.to).toBe("/room/[code]");
    // даже нестандартный ключ чистится (не только url/from/to)
    expect(out.breadcrumbs?.[1].data?.note).toBe("/room/[code]");
    expect(out.breadcrumbs?.[2].data?.foo).toBe("bar");
  });

  it("не падает на пустом событии", () => {
    expect(() => scrubEvent({} as ErrorEvent)).not.toThrow();
  });
});

describe("scrubEvent — тег room для корреляции", () => {
  it("выводит тег из URL события (серверная ошибка на /room/[code])", () => {
    const event = {
      request: { url: "https://app/room/ABC123" },
    } as ErrorEvent;
    const out = scrubEvent(event);
    expect(out.tags?.room).toBe(hashRoomCode("ABC123"));
  });

  it("выводит тег из Referer, когда код не в URL (ошибка /api/token)", () => {
    const event = {
      request: {
        url: "https://app/api/token",
        headers: { referer: "https://app/room/ABC123" },
      },
    } as unknown as ErrorEvent;
    const out = scrubEvent(event);
    expect(out.tags?.room).toBe(hashRoomCode("ABC123"));
  });

  it("не перетирает тег, уже выставленный клиентом", () => {
    const event = {
      tags: { room: "client-set" },
      request: { url: "https://app/room/ABC123" },
    } as unknown as ErrorEvent;
    expect(scrubEvent(event).tags?.room).toBe("client-set");
  });

  it("не ставит тег, если кода комнаты нигде нет", () => {
    const event = { request: { url: "https://app/rooms" } } as ErrorEvent;
    expect(scrubEvent(event).tags?.room).toBeUndefined();
  });
});

describe("scrubEvent — токен личной ссылки заявки", () => {
  it("вырезает t= из адреса, query, заголовков, крошек и текста ошибки", () => {
    const event = {
      message: "failed /request/abc?t=SECRET1",
      request: {
        url: "https://app/request/abcdef?t=SECRET2&x=1",
        query_string: "t=SECRET3&x=1",
        headers: { referer: "https://app/request/abcdef?t=SECRET4", "x-lead-token": "SECRET5" },
      },
      exception: { values: [{ value: "GET /api/leads/abc?t=SECRET6 failed" }] },
      breadcrumbs: [
        { message: "navigate", data: { from: "/request/a?t=SECRET7", to: "/" } },
        { category: "fetch", data: { url: "/api/leads/a?x=1&t=SECRET8#h" } },
      ],
    } as unknown as ErrorEvent;
    const out = JSON.stringify(scrubEvent(event));
    expect(out).not.toMatch(/SECRET\d/);
    expect(out).toContain("t=[token]&x=1");
    expect(out).toContain("[token]#h");
  });

  it("query_string парами и объектом", () => {
    const pairs = scrubEvent({ request: { query_string: [["t", "S"], ["x", "1"]] } } as unknown as ErrorEvent);
    expect(pairs.request?.query_string).toEqual([["t", "[token]"], ["x", "1"]]);
    const obj = scrubEvent({ request: { query_string: { t: "S", x: "1" } } } as unknown as ErrorEvent);
    expect(obj.request?.query_string).toEqual({ t: "[token]", x: "1" });
  });

  it("не трогает похожие параметры (at=, tab=)", () => {
    const out = scrubEvent({ request: { url: "https://app/x?tab=chat&at=5" } } as ErrorEvent);
    expect(out.request?.url).toBe("https://app/x?tab=chat&at=5");
  });
});

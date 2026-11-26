import { describe, expect, it } from "vitest";
import { TEST_FILES } from "./constants";
import { parseCandidate, probeFile, probeTurn, probeVoice, probeWebRtc } from "./probes";

// Проверка замеров без сети: fetch, WebSocket и RTCPeerConnection подменены заготовками.
// Тайм-ауты в тестах короткие (десятки миллисекунд), чтобы они шли быстро.

type Chunk = { size: number; delay?: number };
type FetchPlan = { status?: number; chunks?: Chunk[]; hang?: boolean; networkError?: boolean; stallAfterChunks?: boolean };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch, который отдаёт тело кусками и, как настоящий, обрывает поток при abort. */
function fakeFetch(plan: FetchPlan): typeof fetch {
  return ((_url: string, init?: RequestInit) => {
    const signal = init?.signal ?? undefined;
    const aborted = () => new DOMException("Aborted", "AbortError");
    if (plan.networkError) return Promise.reject(new TypeError("Failed to fetch"));
    if (plan.hang) {
      return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(aborted())));
    }
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        signal?.addEventListener("abort", () => {
          try {
            controller.error(aborted());
          } catch {
            // уже закрыт
          }
        });
        for (const c of plan.chunks ?? []) {
          if (c.delay) await sleep(c.delay);
          if (signal?.aborted) return;
          controller.enqueue(new Uint8Array(c.size));
        }
        if (!plan.stallAfterChunks) controller.close();
      },
    });
    return Promise.resolve(new Response(body, { status: plan.status ?? 200 }));
  }) as unknown as typeof fetch;
}

const FAST = { baseUrl: "https://game-room.space", timeoutMs: 400, stallMs: 60, token: "t1" };

describe("probeFile", () => {
  it("файл пришёл целиком: ok, с временем ответа и числом байт", async () => {
    const f = TEST_FILES[0];
    const r = await probeFile(f, {
      ...FAST,
      fetchFn: fakeFetch({ chunks: [{ size: 8 * 1024 }, { size: 8 * 1024 }] }),
    });
    expect(r.status).toBe("ok");
    expect(r.receivedBytes).toBe(f.bytes);
    expect(r.ttfbMs).not.toBeNull();
    expect(r.httpStatus).toBe(200);
  });

  it("замерзание: пришло 16 КБ из 300 КБ, потом тишина: stalled, раньше общего таймаута", async () => {
    const f = TEST_FILES[2];
    const t0 = Date.now();
    const r = await probeFile(f, { ...FAST, fetchFn: fakeFetch({ chunks: [{ size: 16 * 1024 }], stallAfterChunks: true }) });
    expect(r.status).toBe("stalled");
    expect(r.receivedBytes).toBe(16 * 1024);
    expect(r.expectedBytes).toBe(300 * 1024);
    expect(r.silenceMs).toBeGreaterThanOrEqual(50);
    expect(Date.now() - t0).toBeLessThan(380);
  });

  it("сервер ответил, а данных нет: stalled с нулём байт", async () => {
    const r = await probeFile(TEST_FILES[1], { ...FAST, fetchFn: fakeFetch({ chunks: [], stallAfterChunks: true }) });
    expect(r.status).toBe("stalled");
    expect(r.receivedBytes).toBe(0);
    expect(r.ttfbMs).not.toBeNull();
  });

  it("ответа нет совсем: timeout без ttfb", async () => {
    const r = await probeFile(TEST_FILES[0], { ...FAST, timeoutMs: 80, fetchFn: fakeFetch({ hang: true }) });
    expect(r.status).toBe("timeout");
    expect(r.ttfbMs).toBeNull();
    expect(r.receivedBytes).toBe(0);
  });

  it("поток идёт, но медленно: timeout с прогрессом, а не stalled", async () => {
    const chunks = Array.from({ length: 30 }, () => ({ size: 1024, delay: 20 }));
    const r = await probeFile(TEST_FILES[3], {
      ...FAST,
      timeoutMs: 150,
      stallMs: 100,
      fetchFn: fakeFetch({ chunks, stallAfterChunks: true }),
    });
    expect(r.status).toBe("timeout");
    expect(r.receivedBytes).toBeGreaterThan(0);
    expect(r.receivedBytes).toBeLessThan(TEST_FILES[3].bytes);
  });

  it("сайт ответил 404: error с кодом", async () => {
    const r = await probeFile(TEST_FILES[0], { ...FAST, fetchFn: fakeFetch({ status: 404, chunks: [{ size: 10 }] }) });
    expect(r.status).toBe("error");
    expect(r.httpStatus).toBe(404);
  });

  it("сеть оборвала соединение до ответа: error без кода", async () => {
    const r = await probeFile(TEST_FILES[0], { ...FAST, fetchFn: fakeFetch({ networkError: true }) });
    expect(r.status).toBe("error");
    expect(r.httpStatus).toBeNull();
  });

  it("файл короче ожидаемого и поток закрыт: error (не ok)", async () => {
    const r = await probeFile(TEST_FILES[1], { ...FAST, fetchFn: fakeFetch({ chunks: [{ size: 1000 }] }) });
    expect(r.status).toBe("error");
    expect(r.receivedBytes).toBe(1000);
  });

  it("адрес с параметром ?t=… и путём /check/", async () => {
    let seen = "";
    const spy = ((url: string) => {
      seen = url;
      return Promise.reject(new TypeError("x"));
    }) as unknown as typeof fetch;
    await probeFile(TEST_FILES[2], { ...FAST, fetchFn: spy });
    expect(seen).toBe("https://game-room.space/check/test-300kb.bin?t=t1");
  });

  it("внешняя отмена: возвращает результат, а не зависает", async () => {
    const ctrl = new AbortController();
    const p = probeFile(TEST_FILES[0], { ...FAST, timeoutMs: 5_000, signal: ctrl.signal, fetchFn: fakeFetch({ hang: true }) });
    setTimeout(() => ctrl.abort(), 20);
    const r = await p;
    expect(r.status).toBe("error");
  });
});

// ───────────────────────── голос ─────────────────────────

type WsBehavior = "open" | "error" | "hang";
function fakeWebSocket(behavior: WsBehavior, calls: string[] = []): typeof WebSocket {
  return class {
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    constructor(url: string) {
      calls.push(url);
      if (behavior === "open") setTimeout(() => this.onopen?.(), 5);
      if (behavior === "error") setTimeout(() => this.onerror?.(), 5);
    }
    close() {}
  } as unknown as typeof WebSocket;
}
const httpsOk = (async () => new Response("OK")) as unknown as typeof fetch;
const httpsDown = (async () => {
  throw new TypeError("Failed to fetch");
}) as unknown as typeof fetch;

describe("probeVoice", () => {
  it("HTTPS ответил, WebSocket без токена отказал: сервер достижим", async () => {
    const calls: string[] = [];
    const r = await probeVoice("wss://rtc.game-room.space", {
      fetchFn: httpsOk,
      WebSocketCtor: fakeWebSocket("error", calls),
      timeoutMs: 200,
    });
    expect(r.status).toBe("reachable");
    expect(r.host).toBe("rtc.game-room.space");
    expect(r.https?.ok).toBe(true);
    expect(r.ws?.outcome).toBe("failed");
    expect(calls).toEqual(["wss://rtc.game-room.space/rtc"]);
  });

  it("токены и секреты не отправляются: адрес WebSocket без query", async () => {
    const calls: string[] = [];
    await probeVoice("wss://rtc.game-room.space", { fetchFn: httpsOk, WebSocketCtor: fakeWebSocket("open", calls), timeoutMs: 200 });
    expect(calls[0]).not.toMatch(/token|\?/i);
  });

  it("рукопожатие WebSocket прошло: достижим, даже если HTTPS почему-то не ответил", async () => {
    const r = await probeVoice("wss://rtc.game-room.space", {
      fetchFn: httpsDown,
      WebSocketCtor: fakeWebSocket("open"),
      timeoutMs: 200,
    });
    expect(r.status).toBe("reachable");
    expect(r.ws?.outcome).toBe("open");
  });

  it("ни HTTPS, ни WebSocket: недостижим", async () => {
    const r = await probeVoice("wss://rtc.game-room.space", {
      fetchFn: httpsDown,
      WebSocketCtor: fakeWebSocket("error"),
      timeoutMs: 200,
    });
    expect(r.status).toBe("unreachable");
    expect(r.https).toMatchObject({ ok: false, error: "network" });
  });

  it("тишина до таймаута: timeout в обоих замерах", async () => {
    const hang = ((_u: string, init?: RequestInit) =>
      new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("x", "AbortError"))))) as unknown as typeof fetch;
    const r = await probeVoice("wss://rtc.game-room.space", { fetchFn: hang, WebSocketCtor: fakeWebSocket("hang"), timeoutMs: 60 });
    expect(r.status).toBe("unreachable");
    expect(r.https).toMatchObject({ ok: false, error: "timeout" });
    expect(r.ws?.outcome).toBe("timeout");
  });

  it("адрес не задан: skipped, ничего не открываем", async () => {
    const calls: string[] = [];
    const r = await probeVoice(null, { WebSocketCtor: fakeWebSocket("open", calls) });
    expect(r.status).toBe("skipped");
    expect(calls).toHaveLength(0);
  });
});

// ───────────────────────── WebRTC и TURN ─────────────────────────

describe("parseCandidate", () => {
  it("тип и протокол, адрес не нужен", () => {
    expect(parseCandidate("candidate:1 1 udp 2113937151 abc-def.local 54321 typ host generation 0")).toEqual({
      type: "host",
      protocol: "udp",
    });
    expect(parseCandidate("candidate:2 1 udp 1677729535 203.0.113.5 41000 typ srflx raddr 0.0.0.0 rport 0")).toEqual({
      type: "srflx",
      protocol: "udp",
    });
    expect(parseCandidate("candidate:3 1 tcp 1518280447 10.0.0.2 9 typ host tcptype active")).toEqual({
      type: "host",
      protocol: "tcp",
    });
    expect(parseCandidate("a=candidate:4 1 udp 41885439 198.51.100.7 3478 typ relay raddr 0.0.0.0 rport 0")?.type).toBe("relay");
  });
  it("не кандидат: null", () => {
    expect(parseCandidate("")).toBeNull();
    expect(parseCandidate("candidate:1 1 udp 1 1.2.3.4 5 typ strange")).toBeNull();
  });
});

type IceEvent =
  | { at: number; candidate: string | null }
  | { at: number; error: { errorCode: number; url: string; address?: string } };

/** RTCPeerConnection, который по расписанию «собирает» кандидатов. */
function fakePeerConnection(events: IceEvent[], opts: { noErrorEvent?: boolean; configs?: unknown[] } = {}): typeof RTCPeerConnection {
  return class {
    iceGatheringState = "new";
    onicecandidate: ((e: { candidate: { candidate: string } | null }) => void) | null = null;
    onicegatheringstatechange: (() => void) | null = null;
    onicecandidateerror: ((e: unknown) => void) | null = null;
    closed = false;
    constructor(config: unknown) {
      opts.configs?.push(config);
      if (opts.noErrorEvent) delete (this as { onicecandidateerror?: unknown }).onicecandidateerror;
    }
    createDataChannel() {}
    async createOffer() {
      return { type: "offer", sdp: "" };
    }
    async setLocalDescription() {
      for (const ev of events) {
        setTimeout(() => {
          if (this.closed) return;
          if ("error" in ev) this.onicecandidateerror?.(ev.error);
          else if (ev.candidate === null) {
            this.iceGatheringState = "complete";
            this.onicecandidate?.({ candidate: null });
            this.onicegatheringstatechange?.();
          } else this.onicecandidate?.({ candidate: { candidate: ev.candidate } });
        }, ev.at);
      }
    }
    close() {
      this.closed = true;
    }
  } as unknown as typeof RTCPeerConnection;
}

const HOST = "candidate:1 1 udp 2113937151 abc-def.local 54321 typ host generation 0";
const SRFLX = "candidate:2 1 udp 1677729535 203.0.113.5 41000 typ srflx raddr 0.0.0.0 rport 0";

describe("probeWebRtc", () => {
  it("наш STUN ответил: srflx > 0, статус ok, адрес в результат не попал", async () => {
    const r = await probeWebRtc("turn.game-room.space", {
      PeerConnection: fakePeerConnection([
        { at: 5, candidate: HOST },
        { at: 25, candidate: SRFLX },
      ]),
      timeoutMs: 500,
    });
    expect(r.status).toBe("ok");
    expect(r).toMatchObject({ host: 1, srflx: 1, relay: 0, completed: true });
    expect(r.firstSrflxMs).toBeGreaterThanOrEqual(20);
    expect(r.stunUrls).toEqual(["stun:turn.game-room.space:3478", "stun:turn.game-room.space:443"]);
    expect(JSON.stringify(r)).not.toMatch(/203\.0\.113\.5|\.local/);
  });

  it("только host и сбор завершился сам: no-srflx, ошибки STUN сохранены кодом и адресом нашего сервера", async () => {
    const r = await probeWebRtc("turn.game-room.space", {
      PeerConnection: fakePeerConnection([
        { at: 5, candidate: HOST },
        { at: 10, error: { errorCode: 701, url: "stun:turn.game-room.space:3478", address: "192.168.1.5" } },
        { at: 20, candidate: null },
      ]),
      timeoutMs: 500,
    });
    expect(r.status).toBe("no-srflx");
    expect(r.host).toBe(1);
    expect(r.srflx).toBe(0);
    expect(r.errors).toEqual([{ code: 701, url: "stun:turn.game-room.space:3478" }]);
    expect(JSON.stringify(r)).not.toMatch(/192\.168/);
  });

  it("тишина до таймаута: no-srflx, completed=false", async () => {
    const r = await probeWebRtc("turn.game-room.space", { PeerConnection: fakePeerConnection([]), timeoutMs: 60 });
    expect(r.status).toBe("no-srflx");
    expect(r.completed).toBe(false);
  });

  it("нет WebRTC: unsupported; нет имени: skipped", async () => {
    // В среде vitest (node) RTCPeerConnection нет.
    expect((await probeWebRtc("turn.game-room.space")).status).toBe("unsupported");
    expect((await probeWebRtc(null)).status).toBe("skipped");
  });
});

describe("probeTurn", () => {
  it("TURN ответил отказом 401 по TLS: достижим, просим turns:…:443 с заведомо неверными данными", async () => {
    const configs: { iceServers: { urls: string; username: string; credential: string }[]; iceTransportPolicy: string }[] = [];
    const r = await probeTurn("turn.game-room.space", {
      PeerConnection: fakePeerConnection(
        [{ at: 15, error: { errorCode: 401, url: "turns:turn.game-room.space:443?transport=tcp" } }],
        { configs },
      ),
      timeoutMs: 500,
    });
    expect(r.status).toBe("reachable");
    expect(r.code).toBe(401);
    expect(r.ms).toBeGreaterThanOrEqual(10);
    expect(configs[0].iceTransportPolicy).toBe("relay");
    expect(configs[0].iceServers[0].urls).toBe("turns:turn.game-room.space:443?transport=tcp");
    expect(configs[0].iceServers[0].username).toBe("gameroom-check");
  });

  it("код 400 (неверный пользователь) тоже ответ сервера", async () => {
    const r = await probeTurn("turn.game-room.space", {
      PeerConnection: fakePeerConnection([{ at: 5, error: { errorCode: 400, url: "turns:turn.game-room.space:443?transport=tcp" } }]),
      timeoutMs: 500,
    });
    expect(r.status).toBe("reachable");
    expect(r.code).toBe(400);
  });

  it("701: не дошли; сбор закончился без ответа: unreachable с кодом ошибки", async () => {
    const r = await probeTurn("turn.game-room.space", {
      PeerConnection: fakePeerConnection([
        { at: 5, error: { errorCode: 701, url: "turns:turn.game-room.space:443?transport=tcp" } },
        { at: 15, candidate: null },
      ]),
      timeoutMs: 500,
    });
    expect(r.status).toBe("unreachable");
    expect(r.failCodes).toEqual([701]);
  });

  it("тишина до таймаута: unreachable", async () => {
    const r = await probeTurn("turn.game-room.space", { PeerConnection: fakePeerConnection([]), timeoutMs: 60 });
    expect(r.status).toBe("unreachable");
  });

  it("браузер не показывает ответы TURN (Firefox): unsupported, а не ложное «нет ответа»", async () => {
    const r = await probeTurn("turn.game-room.space", {
      PeerConnection: fakePeerConnection([], { noErrorEvent: true }),
      timeoutMs: 60,
    });
    expect(r.status).toBe("unsupported");
  });

  it("нет имени: skipped; нет WebRTC: unsupported", async () => {
    expect((await probeTurn(null)).status).toBe("skipped");
    expect((await probeTurn("turn.game-room.space")).status).toBe("unsupported");
  });
});

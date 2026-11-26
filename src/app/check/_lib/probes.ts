import {
  FILE_STALL_MS,
  FILE_TIMEOUT_MS,
  ICE_TIMEOUT_MS,
  STUN_PORTS,
  TEST_FILES_PATH,
  TURN_PROBE_PASSWORD,
  TURN_PROBE_USER,
  TURN_TLS_PORT,
  VOICE_TIMEOUT_MS,
  type TestFile,
} from "./constants";
import { parseVoiceUrl } from "./hosts";
import type {
  FileResult,
  HttpsProbe,
  IceError,
  TurnResult,
  VoiceResult,
  WebRtcResult,
  WsProbe,
} from "./types";

// Замеры в браузере. Ничего не пишут на сервер: качают наши тестовые файлы, пробуют
// достучаться до наших имён rtc.… и turn.… и просят наш же STUN. Зависимости (fetch,
// часы, WebSocket, RTCPeerConnection) подставляются снаружи, чтобы логику можно было
// проверить тестами.

type Clock = () => number;
const defaultNow: Clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

function randomToken(): string {
  return `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

// ───────────────────────── Сайт: скачивание тестового файла ─────────────────────────

export type ProbeFileOptions = {
  /** Наш домен, например https://game-room.space (location.origin). */
  baseUrl: string;
  fetchFn?: typeof fetch;
  now?: Clock;
  timeoutMs?: number;
  stallMs?: number;
  /** Параметр ?t=…, чтобы ни браузер, ни прокси не отдали файл из кэша. */
  token?: string;
  signal?: AbortSignal;
};

/**
 * Качает один тестовый файл и считает байты по мере прихода. Не ждёт все 10 секунд,
 * если поток встал: тишина дольше stallMs после ответа сервера = «замерзло».
 */
export async function probeFile(file: TestFile, opts: ProbeFileOptions): Promise<FileResult> {
  const now = opts.now ?? defaultNow;
  const timeoutMs = opts.timeoutMs ?? FILE_TIMEOUT_MS;
  const stallMs = opts.stallMs ?? FILE_STALL_MS;
  const fetchFn = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
  const url = `${opts.baseUrl.replace(/\/$/, "")}${TEST_FILES_PATH}${file.name}?t=${opts.token ?? randomToken()}`;

  const controller = new AbortController();
  let reason: "timeout" | "stall" | "external" | null = null;
  const abort = (why: "timeout" | "stall" | "external") => {
    reason ??= why;
    controller.abort();
  };
  const onExternal = () => abort("external");
  if (opts.signal?.aborted) abort("external");
  opts.signal?.addEventListener("abort", onExternal, { once: true });

  const started = now();
  const totalTimer = setTimeout(() => abort("timeout"), timeoutMs);
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  let lastProgress = started;
  const armStall = () => {
    if (stallTimer) clearTimeout(stallTimer);
    lastProgress = now();
    stallTimer = setTimeout(() => abort("stall"), stallMs);
  };

  let received = 0;
  let ttfb: number | null = null;
  let httpStatus: number | null = null;

  const done = (status: FileResult["status"]): FileResult => ({
    id: file.id,
    label: file.label,
    expectedBytes: file.bytes,
    status,
    receivedBytes: received,
    ttfbMs: ttfb === null ? null : Math.round(ttfb),
    totalMs: Math.round(now() - started),
    httpStatus,
    silenceMs: status === "stalled" ? Math.round(now() - lastProgress) : null,
  });

  try {
    const res = await fetchFn(url, { cache: "no-store", credentials: "omit", signal: controller.signal });
    ttfb = now() - started;
    httpStatus = res.status;
    if (!res.ok) {
      controller.abort();
      return done("error");
    }
    armStall();
    const reader = res.body?.getReader();
    if (reader) {
      for (;;) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        received += value.byteLength;
        armStall();
      }
    } else {
      received = (await res.arrayBuffer()).byteLength;
    }
    return done(received >= file.bytes ? "ok" : "error");
  } catch {
    if (reason === "stall") return done("stalled");
    if (reason === "timeout") return done("timeout");
    return done("error");
  } finally {
    clearTimeout(totalTimer);
    if (stallTimer) clearTimeout(stallTimer);
    opts.signal?.removeEventListener("abort", onExternal);
  }
}

// ───────────────────────── Сервер голоса (rtc.…): HTTPS и WebSocket ─────────────────────────

export type ProbeVoiceOptions = {
  fetchFn?: typeof fetch;
  WebSocketCtor?: typeof WebSocket;
  now?: Clock;
  timeoutMs?: number;
  signal?: AbortSignal;
};

type VoiceInternal = ProbeVoiceOptions & { timeoutMs: number; now: Clock };

async function probeHttps(url: string, o: VoiceInternal): Promise<HttpsProbe> {
  const fetchFn = o.fetchFn ?? globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, o.timeoutMs);
  const onExternal = () => controller.abort();
  o.signal?.addEventListener("abort", onExternal, { once: true });
  const started = o.now();
  try {
    // no-cors: ответ «непрозрачный», тело и код не видны, но сам факт ответа сервера
    // (любого, и 200, и 404) значит, что TLS и HTTP до него дошли. Ради этого и замер.
    await fetchFn(url, { mode: "no-cors", cache: "no-store", credentials: "omit", signal: controller.signal });
    return { ok: true, ms: Math.round(o.now() - started), error: null };
  } catch {
    return { ok: false, ms: null, error: timedOut ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener("abort", onExternal);
  }
}

function probeWs(url: string, o: VoiceInternal): Promise<WsProbe> {
  const Ctor = o.WebSocketCtor ?? (typeof WebSocket === "undefined" ? undefined : WebSocket);
  const started = o.now();
  return new Promise<WsProbe>((resolve) => {
    let settled = false;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (outcome: WsProbe["outcome"]) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      o.signal?.removeEventListener("abort", onExternal);
      try {
        socket?.close(1000);
      } catch {
        // уже закрыт
      }
      resolve({ outcome, ms: Math.round(o.now() - started) });
    };
    const onExternal = () => finish("failed");
    if (!Ctor) {
      finish("failed");
      return;
    }
    timer = setTimeout(() => finish("timeout"), o.timeoutMs);
    o.signal?.addEventListener("abort", onExternal, { once: true });
    try {
      // Без токена: рукопожатие дойдёт до сервера, и тот ответит отказом (401). Нам
      // важно, что до него дошли по TLS, а не пустил ли он: секреты не отправляем.
      socket = new Ctor(url);
    } catch {
      finish("failed");
      return;
    }
    socket.onopen = () => finish("open");
    socket.onerror = () => finish("failed");
    socket.onclose = () => finish("failed");
  });
}

/** Достучаться до сервера голоса двумя способами сразу: HTTPS-запрос и WebSocket. */
export async function probeVoice(voiceUrl: string | null | undefined, opts: ProbeVoiceOptions = {}): Promise<VoiceResult> {
  const parsed = parseVoiceUrl(voiceUrl);
  if (!parsed) return { url: null, host: null, status: "skipped", https: null, ws: null };
  const o: VoiceInternal = { ...opts, timeoutMs: opts.timeoutMs ?? VOICE_TIMEOUT_MS, now: opts.now ?? defaultNow };
  const [https, ws] = await Promise.all([probeHttps(`${parsed.httpOrigin}/`, o), probeWs(parsed.wsUrl, o)]);
  return {
    url: parsed.url,
    host: parsed.host,
    status: https.ok || ws.outcome === "open" ? "reachable" : "unreachable",
    https,
    ws,
  };
}

// ───────────────────────── Разбор строки ICE-кандидата ─────────────────────────

export type CandidateInfo = { type: "host" | "srflx" | "prflx" | "relay"; protocol: "udp" | "tcp" };

/** Тип и протокол из строки кандидата. Адрес намеренно не читаем и никуда не кладём. */
export function parseCandidate(line: string): CandidateInfo | null {
  const type = /\btyp (host|srflx|prflx|relay)\b/.exec(line)?.[1] as CandidateInfo["type"] | undefined;
  if (!type) return null;
  const protocol = /^(?:a=)?candidate:\S+ \d+ (udp|tcp)\b/i.exec(line)?.[1]?.toLowerCase() as
    | CandidateInfo["protocol"]
    | undefined;
  return { type, protocol: protocol ?? "udp" };
}

// ───────────────────────── TURN (turn.…): TLS на 443 ─────────────────────────

export type ProbeTurnOptions = {
  now?: Clock;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Для тестов: подмена конструктора. */
  PeerConnection?: typeof RTCPeerConnection;
};

/**
 * Достучаться до TURN по TLS (turns:…:443). Браузер не умеет открывать «голый» TLS-сокет,
 * поэтому просим TURN выдать канал с заведомо неверными данными: сервер, до которого
 * дошли по TLS, ответит отказом (400/401), и Chrome покажет этот код в событии
 * icecandidateerror. Код меньше 700 значит «сервер ответил»; 701 и тишина значат «не
 * дошли». Канала (relay) мы так не получаем и не пытаемся: настоящие данные TURN LiveKit
 * выдаёт только при входе в комнату.
 */
export async function probeTurn(turnHost: string | null | undefined, opts: ProbeTurnOptions = {}): Promise<TurnResult> {
  const now = opts.now ?? defaultNow;
  const host = turnHost ?? null;
  const url = host ? `turns:${host}:${TURN_TLS_PORT}?transport=tcp` : null;
  const result = (status: TurnResult["status"], extra: Partial<TurnResult> = {}): TurnResult => ({
    status,
    host,
    url,
    code: null,
    ms: null,
    failCodes: [],
    ...extra,
  });
  if (!host || !url) return result("skipped");
  const PC = opts.PeerConnection ?? (typeof RTCPeerConnection === "undefined" ? undefined : RTCPeerConnection);
  if (!PC) return result("unsupported");

  let pc: RTCPeerConnection;
  try {
    pc = new PC({
      iceServers: [{ urls: url, username: TURN_PROBE_USER, credential: TURN_PROBE_PASSWORD }],
      iceTransportPolicy: "relay",
    });
  } catch {
    return result("error");
  }
  // Firefox не показывает ответы TURN: без события «ответа нет» от «ответ был» не отличить.
  if (!("onicecandidateerror" in (pc as object))) {
    pc.close();
    return result("unsupported");
  }

  const timeoutMs = opts.timeoutMs ?? ICE_TIMEOUT_MS;
  const started = now();
  const failCodes: number[] = [];
  return new Promise<TurnResult>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (r: TurnResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onExternal);
      try {
        pc.close();
      } catch {
        // уже закрыт
      }
      resolve(r);
    };
    const answered = (code: number | null) =>
      finish(result("reachable", { code, ms: Math.round(now() - started), failCodes }));
    const silent = () => finish(result("unreachable", { failCodes }));
    const onExternal = () => finish(result("error", { failCodes }));
    opts.signal?.addEventListener("abort", onExternal, { once: true });
    timer = setTimeout(silent, timeoutMs);

    pc.onicecandidateerror = (e) => {
      const ev = e as RTCPeerConnectionIceErrorEvent;
      if (typeof ev.errorCode !== "number") return;
      if (ev.errorCode >= 300 && ev.errorCode < 700) answered(ev.errorCode);
      else if (failCodes.length < 6) failCodes.push(ev.errorCode);
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        // Редкий случай: сервер всё же выдал канал. Тем более ответил.
        if (parseCandidate(e.candidate.candidate)?.type === "relay") answered(null);
      } else {
        silent();
      }
    };
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") silent();
    };

    (async () => {
      try {
        pc.createDataChannel("check");
        await pc.setLocalDescription(await pc.createOffer());
      } catch {
        finish(result("error", { failCodes }));
      }
    })();
  });
}

// ───────────────────────── WebRTC: UDP до нашего сервера (STUN) ─────────────────────────

export type ProbeWebRtcOptions = {
  now?: Clock;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Для тестов: подмена конструктора. */
  PeerConnection?: typeof RTCPeerConnection;
};

/**
 * Собирает ICE-кандидатов с нашим сервером в роли STUN: ответ даёт кандидата srflx и
 * значит, что UDP до сервера проходит. Канал TURN (relay) здесь не проверяется: данные
 * для него LiveKit выдаёт только при входе в настоящую комнату.
 */
export async function probeWebRtc(stunHostname: string | null | undefined, opts: ProbeWebRtcOptions = {}): Promise<WebRtcResult> {
  const now = opts.now ?? defaultNow;
  const empty = (status: WebRtcResult["status"], stunUrls: string[] = []): WebRtcResult => ({
    status,
    stunUrls,
    host: 0,
    srflx: 0,
    relay: 0,
    firstHostMs: null,
    firstSrflxMs: null,
    doneMs: null,
    completed: false,
    errors: [],
  });
  if (!stunHostname) return empty("skipped");
  const PC = opts.PeerConnection ?? (typeof RTCPeerConnection === "undefined" ? undefined : RTCPeerConnection);
  const stunUrls = STUN_PORTS.map((p) => `stun:${stunHostname}:${p}`);
  if (!PC) return empty("unsupported", stunUrls);

  const timeoutMs = opts.timeoutMs ?? ICE_TIMEOUT_MS;
  const started = now();
  const r = empty("no-srflx", stunUrls);
  const errors: IceError[] = [];

  let pc: RTCPeerConnection;
  try {
    pc = new PC({ iceServers: [{ urls: stunUrls }] });
  } catch {
    return empty("error", stunUrls);
  }

  return new Promise<WebRtcResult>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let early: ReturnType<typeof setTimeout> | null = null;
    const finish = (completed: boolean, failed = false) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (early) clearTimeout(early);
      opts.signal?.removeEventListener("abort", onExternal);
      try {
        pc.close();
      } catch {
        // уже закрыт
      }
      r.doneMs = Math.round(now() - started);
      r.completed = completed;
      r.errors = errors;
      r.status = failed ? "error" : r.srflx > 0 ? "ok" : "no-srflx";
      resolve(r);
    };
    const onExternal = () => finish(false, true);
    opts.signal?.addEventListener("abort", onExternal, { once: true });
    timer = setTimeout(() => finish(false), timeoutMs);

    pc.onicecandidate = (e) => {
      if (!e.candidate) {
        finish(true);
        return;
      }
      const info = parseCandidate(e.candidate.candidate);
      if (!info) return;
      const at = Math.round(now() - started);
      if (info.type === "host") {
        r.host++;
        r.firstHostMs ??= at;
      } else if (info.type === "srflx" || info.type === "prflx") {
        r.srflx++;
        r.firstSrflxMs ??= at;
        // Ответ нашего STUN пришёл: UDP до сервера проходит, дальше ждать незачем
        // (короткая пауза, чтобы успели прийти остальные кандидаты).
        early ??= setTimeout(() => finish(true), 300);
      } else if (info.type === "relay") {
        r.relay++;
      }
    };
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") finish(true);
    };
    pc.onicecandidateerror = (e) => {
      const ev = e as RTCPeerConnectionIceErrorEvent;
      // Только код и адрес нашего STUN: локальный адрес устройства (ev.address) не берём.
      if (typeof ev.errorCode === "number" && errors.length < 6) errors.push({ code: ev.errorCode, url: ev.url ?? "" });
    };

    (async () => {
      try {
        pc.createDataChannel("check");
        await pc.setLocalDescription(await pc.createOffer());
      } catch {
        finish(false, true);
      }
    })();
  });
}

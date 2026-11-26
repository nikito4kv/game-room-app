// Стенд снаружи браузера: API сайта, серверный API LiveKit (по ключам стенда),
// Redis через REST и перезапуск всего стенда.
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { RoomServiceClient, TrackSource } from "livekit-server-sdk";
import {
  DEFAULT_WEBHOOK_PORTS,
  LIVEKIT,
  REDIS_REST,
  ROOT,
  STACK_ERR,
  STACK_LOG,
  STACK_PID,
} from "./env.mjs";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const lk = new RoomServiceClient(LIVEKIT.url, LIVEKIT.key, LIVEKIT.secret);
export { TrackSource };

/**
 * Запрос к API сайта. Тело ответа — JSON или null. ip — свой X-Real-IP: сервер
 * считает лимиты по IP, а тесты создают много комнат подряд с одной машины.
 */
export async function api(base, method, pathname, body, { headers = {}, ip } = {}) {
  const res = await fetch(base + pathname, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(ip ? { "x-real-ip": ip } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, body: json, headers: res.headers };
}

/** Адрес из диапазона для тестов (RFC 2544): у каждой комнаты свой лимит создания. */
const testIp = () => `198.18.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`;

/** POST /api/rooms → { code, hostKey }. На 429 ждёт и повторяет. */
export async function createRoom(base, { title, password, isPublic } = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await api(base, "POST", "/api/rooms", { title, password, isPublic }, { ip: testIp() });
    if (r.status === 429) {
      await sleep((Number(r.headers.get("retry-after")) || 10) * 1000);
      continue;
    }
    if (r.status !== 200 || !r.body?.code) {
      throw new Error(`создание комнаты: HTTP ${r.status} ${JSON.stringify(r.body)}`);
    }
    return r.body;
  }
  throw new Error("создание комнаты: всё время 429");
}

/** Код, которого точно нет: 6 символов из алфавита кодов, сервер отвечает 404. */
export async function missingRoomCode(base) {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  for (let i = 0; i < 10; i++) {
    let code = "";
    for (let j = 0; j < 6; j++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    const r = await api(base, "GET", `/api/rooms/${code}`);
    if (r.status === 404) return code;
  }
  throw new Error("не нашёлся свободный код комнаты");
}

/** Описание комнаты из metadata LiveKit (null — комнаты в LiveKit нет). */
export async function roomMeta(code) {
  const [room] = await lk.listRooms([code]).catch(() => []);
  if (!room) return null;
  try {
    return JSON.parse(room.metadata || "null");
  } catch {
    return null;
  }
}

export async function participants(code) {
  return lk.listParticipants(code).catch(() => []);
}

export async function participant(code, identity) {
  return (await participants(code)).find((p) => p.identity === identity) ?? null;
}

/** Заглушён ли микрофон участника на сервере: true/false, null — трека нет. */
export async function micMuted(code, identity) {
  const p = await participant(code, identity);
  const t = p?.tracks.find((x) => x.source === TrackSource.MICROPHONE);
  return t ? t.muted : null;
}

/** Что участнику разрешено публиковать (TrackSource[]). */
export async function canPublish(code, identity) {
  const p = await participant(code, identity);
  return p ? [...(p.permission?.canPublishSources ?? [])] : null;
}

/** Команда Redis через REST-прослойку стенда (как у Upstash). */
export async function redis(command) {
  const res = await fetch(REDIS_REST.url, {
    method: "POST",
    headers: { authorization: `Bearer ${REDIS_REST.token}`, "content-type": "application/json" },
    body: JSON.stringify(command),
  });
  return res.json();
}

/** «3000,3100-3119» + порт сайта под проверкой, если его там нет. */
export function webhookPorts(base) {
  const port = Number(new URL(base).port || 80);
  const covered = DEFAULT_WEBHOOK_PORTS.split(",").some((part) => {
    const [a, b] = part.split("-").map(Number);
    return b ? port >= a && port <= b : port === a;
  });
  return covered ? DEFAULT_WEBHOOK_PORTS : `${DEFAULT_WEBHOOK_PORTS},${port}`;
}

async function alive(url, init) {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

const livekitUp = () => alive(LIVEKIT.url.replace(/^ws/, "http"));
const redisUp = async () => {
  try {
    return (await redis(["PING"])).result === "PONG";
  } catch {
    return false;
  }
};

/** Стенд запущен отдельным процессом (есть .dev-stack/stack.pid и процесс жив). */
export function stackPid() {
  try {
    const pid = Number(fs.readFileSync(STACK_PID, "utf8").trim());
    if (!pid) return null;
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

/**
 * Перезапуск всего стенда тем же способом, каким его запускают отдельно:
 * `node scripts/dev-stack/start.mjs` в фоне, логи в .dev-stack, новый PID — в
 * stack.pid. Только LiveKit перезапустить нельзя: start.mjs гасит всё, если
 * упал любой его процесс.
 *
 * Redis на стенде живёт без сохранений (--save ""), а на проде он переживает
 * перезапуск LiveKit. Поэтому перед остановкой — SAVE (dump.rdb в .dev-stack/redis),
 * новый Redis читает его при старте; после старта файл удаляем, чтобы следующий
 * перезапуск стенда не поднял старые данные.
 *
 * webhookPorts — кому раздавать вебхуки LiveKit (APP_PORTS прослойки): сайт под
 * проверкой должен их получать, иначе замок и уход хоста работают не как на проде.
 * Возвращает { pid, downMs }: сколько стенд был недоступен.
 */
export async function restartStack({ webhookPorts: ports = DEFAULT_WEBHOOK_PORTS } = {}) {
  const pid = stackPid();
  if (!pid) throw new Error("стенд запущен не отдельным процессом: нет живого PID в .dev-stack/stack.pid");
  const saved = await redis(["SAVE"]);
  if (saved.result !== "OK") throw new Error(`Redis SAVE: ${JSON.stringify(saved)}`);
  const t0 = Date.now();
  if (process.platform === "win32") {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    process.kill(pid, "SIGTERM");
  }
  for (let i = 0; i < 60 && ((await livekitUp()) || (await redisUp())); i++) await sleep(250);

  const out = fs.openSync(STACK_LOG, "a");
  const err = fs.openSync(STACK_ERR, "a");
  const child = spawn(process.execPath, [path.join("scripts", "dev-stack", "start.mjs")], {
    cwd: ROOT,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", out, err],
    env: { ...process.env, APP_PORTS: ports },
  });
  child.unref();
  fs.closeSync(out);
  fs.closeSync(err);
  fs.writeFileSync(STACK_PID, String(child.pid));

  for (let i = 0; i < 120 && !((await livekitUp()) && (await redisUp())); i++) await sleep(250);
  if (!((await livekitUp()) && (await redisUp()))) throw new Error("стенд не поднялся за 30 с после перезапуска");
  fs.rmSync(path.join(ROOT, ".dev-stack", "redis", "dump.rdb"), { force: true });
  return { pid: child.pid, downMs: Date.now() - t0 };
}

/** Перед прогоном: сайт и стенд отвечают. Возвращает текст проблемы или null. */
export async function preflight(base) {
  if (!(await alive(base + "/"))) return `сайт ${base} не отвечает`;
  if (!(await livekitUp())) return `LiveKit ${LIVEKIT.url} не отвечает — запустите стенд (npm run stack)`;
  if (!(await redisUp())) return `Redis REST ${REDIS_REST.url} не отвечает — запустите стенд (npm run stack)`;
  return null;
}

/** Кэш настроек продукта на сервере — 10 с (CONFIG_CACHE_MS): после записи ждём чуть дольше. */
const CONFIG_SETTLE_MS = 11_000;

/**
 * Включить флаги продукта (gr:cfg) на время fn и вернуть настройки как были.
 * Настройки общие на весь сайт, поэтому только у локального стенда: Redis не
 * локальный — сценарий пропускается (t.skip), чужой сайт не трогаем.
 */
export async function withFlags(t, flags, fn) {
  const host = new URL(REDIS_REST.url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") t.skip(`Redis не локальный (${host}): gr:cfg не трогаем`);
  const before = (await redis(["GET", "gr:cfg"])).result ?? null;
  const cfg = before ? JSON.parse(before) : { flags: {}, rev: 0 };
  const rules = Object.fromEntries(Object.keys(flags).map((name) => [name, { mode: flags[name] ? "on" : "off" }]));
  await redis(["SET", "gr:cfg", JSON.stringify({ ...cfg, flags: { ...cfg.flags, ...rules } })]);
  try {
    await sleep(CONFIG_SETTLE_MS);
    await fn();
  } finally {
    await redis(before === null ? ["DEL", "gr:cfg"] : ["SET", "gr:cfg", before]);
  }
}

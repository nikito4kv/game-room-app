// REST-прослойка «как у Upstash» над обычным Redis + раздача вебхуков LiveKit
// на все запущенные дев-серверы. Только для локальной разработки и e2e.
//
//   POST /            ["SET","k","v"]          → {"result": ...}
//   POST /pipeline    [["GET","a"],["GET","b"]] → [{"result": ...}, ...]
//   POST /multi-exec  то же, но атомарно       → [{"result": ...}, ...]
//   POST /webhook     (от LiveKit)             → копия на APP_PORTS, кто жив
//
// @upstash/redis по умолчанию шлёт «Upstash-Encoding: base64» и ждёт строки в
// base64 — кодируем все строковые ответы, числа и null отдаём как есть.
import http from "node:http";
import net from "node:net";

const PORT = Number(process.env.REST_PORT ?? 8079);
const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6390);
const TOKEN = process.env.REST_TOKEN ?? "dev";
const APP_PORTS = (process.env.APP_PORTS ?? "3000,3100-3119")
  .split(",")
  .flatMap((p) => {
    const [a, b] = p.split("-").map(Number);
    return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a];
  });

/** Одно соединение на HTTP-запрос: так MULTI/EXEC не перемешиваются с чужими командами. */
function redisCommands(commands) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ port: REDIS_PORT, host: "127.0.0.1" });
    const replies = [];
    let buf = Buffer.alloc(0);
    sock.on("error", reject);
    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const parsed = parse(buf, 0);
        if (!parsed) break;
        replies.push(parsed.value);
        buf = buf.subarray(parsed.end);
        if (replies.length === commands.length) {
          sock.end();
          return resolve(replies);
        }
      }
    });
    const out = [];
    for (const cmd of commands) {
      out.push(Buffer.from(`*${cmd.length}\r\n`));
      for (const arg of cmd) {
        const b = Buffer.from(typeof arg === "string" ? arg : JSON.stringify(arg));
        out.push(Buffer.from(`$${b.length}\r\n`), b, Buffer.from("\r\n"));
      }
    }
    sock.write(Buffer.concat(out));
  });
}

class RedisError extends Error {}

/** Разбор одного RESP-ответа; null — данных пока не хватает. */
function parse(buf, at) {
  const eol = buf.indexOf("\r\n", at);
  if (eol < 0) return null;
  const type = String.fromCharCode(buf[at]);
  const line = buf.toString("utf8", at + 1, eol);
  const next = eol + 2;
  switch (type) {
    case "+":
      return { value: line, end: next };
    case "-":
      return { value: new RedisError(line), end: next };
    case ":":
      return { value: Number(line), end: next };
    case "$": {
      const len = Number(line);
      if (len < 0) return { value: null, end: next };
      if (buf.length < next + len + 2) return null;
      return { value: buf.toString("utf8", next, next + len), end: next + len + 2 };
    }
    case "*": {
      const n = Number(line);
      if (n < 0) return { value: null, end: next };
      const arr = [];
      let pos = next;
      for (let i = 0; i < n; i++) {
        const item = parse(buf, pos);
        if (!item) return null;
        arr.push(item.value);
        pos = item.end;
      }
      return { value: arr, end: pos };
    }
    default:
      throw new Error(`RESP: неизвестный тип ${type}`);
  }
}

function encode(v, base64) {
  if (typeof v === "string") return base64 ? Buffer.from(v).toString("base64") : v;
  if (Array.isArray(v)) return v.map((x) => (x instanceof RedisError ? null : encode(x, base64)));
  return v;
}

const wrap = (v, base64) =>
  v instanceof RedisError ? { error: v.message } : { result: encode(v, base64) };

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
}

async function fanOutWebhook(req, res) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const headers = {
    "content-type": req.headers["content-type"] ?? "application/webhook+json",
    authorization: req.headers.authorization ?? "",
  };
  res.writeHead(200).end();
  await Promise.allSettled(
    APP_PORTS.map((p) =>
      fetch(`http://127.0.0.1:${p}/api/livekit-webhook`, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(5000),
      }),
    ),
  );
}

http
  .createServer(async (req, res) => {
    try {
      if (req.method === "POST" && req.url === "/webhook") return await fanOutWebhook(req, res);
      if (req.headers.authorization !== `Bearer ${TOKEN}`) {
        return res.writeHead(401, { "content-type": "application/json" }).end('{"error":"Unauthorized"}');
      }
      const base64 = String(req.headers["upstash-encoding"] ?? "").toLowerCase() === "base64";
      const body = await readJson(req);
      const path = (req.url ?? "/").split("?")[0];
      let payload;
      if (path === "/pipeline") {
        const replies = await redisCommands(body);
        payload = replies.map((r) => wrap(r, base64));
      } else if (path === "/multi-exec") {
        const replies = await redisCommands([["MULTI"], ...body, ["EXEC"]]);
        const exec = replies[replies.length - 1];
        payload = exec instanceof RedisError ? [{ error: exec.message }] : exec.map((r) => wrap(r, base64));
      } else {
        const [reply] = await redisCommands([body]);
        payload = wrap(reply, base64);
        if (reply instanceof RedisError) {
          return res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify(payload));
        }
      }
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(payload));
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: String(e) }));
    }
  })
  .listen(PORT, "127.0.0.1", () =>
    console.log(`redis-rest: http://127.0.0.1:${PORT} → redis :${REDIS_PORT}; вебхуки → порты ${APP_PORTS[0]}…`),
  );

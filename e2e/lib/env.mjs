// Где что лежит и с какими ключами ходить к стенду. Ключи LiveKit и Redis берём
// из окружения, затем из .env.local, затем — значения стенда (scripts/dev-stack).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Простейший разбор KEY=VALUE: стенду хватает, а dotenv ради этого не тянем. */
function readEnvFile(file) {
  const out = {};
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

const fileEnv = readEnvFile(path.join(ROOT, ".env.local"));
const pick = (key, fallback) => process.env[key] ?? fileEnv[key] ?? fallback;

export const LIVEKIT = {
  url: pick("LIVEKIT_URL", "http://127.0.0.1:7880"),
  key: pick("LIVEKIT_API_KEY", "devkey"),
  secret: pick("LIVEKIT_API_SECRET", "secret"),
};

export const REDIS_REST = {
  url: pick("UPSTASH_REDIS_REST_URL", "http://127.0.0.1:8079"),
  token: pick("UPSTASH_REDIS_REST_TOKEN", "dev"),
};

/** Речь для фейкового микрофона (без неё Chrome пищит; нет файла — синтезирует speech.mjs). */
export const SPEECH_WAV = path.join(ROOT, ".dev-stack", "speech.wav");
/** PID стенда, если он запущен отдельным процессом (нужен сценарию restart). */
export const STACK_PID = path.join(ROOT, ".dev-stack", "stack.pid");
export const STACK_LOG = path.join(ROOT, ".dev-stack", "stack.log");
export const STACK_ERR = path.join(ROOT, ".dev-stack", "stack.err.log");
/** Порты дев-серверов, которым стенд раздаёт вебхуки LiveKit (scripts/dev-stack/redis-rest.mjs). */
export const DEFAULT_WEBHOOK_PORTS = "3000,3100-3119";

// Поднимает локальный стенд: Redis :6390, REST-прослойку :8079 (как Upstash) и
// LiveKit :7880. Ctrl+C гасит всё. Сайт запускается отдельно (`npm run dev`),
// переменные — в scripts/dev-stack/env.example.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "../..");
const BIN = path.join(ROOT, ".dev-stack", "bin");
const DATA = path.join(ROOT, ".dev-stack", "redis");
fs.mkdirSync(DATA, { recursive: true });
const win = process.platform === "win32";

const local = (name) => {
  const p = path.join(BIN, win ? `${name}.exe` : name);
  return fs.existsSync(p) ? p : name; // иначе — из PATH
};

const children = [];
function run(label, cmd, args, env) {
  const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env } });
  const tag = (line) => line && console.log(`[${label}] ${line}`);
  child.stdout.on("data", (d) => String(d).split(/\r?\n/).forEach(tag));
  child.stderr.on("data", (d) => String(d).split(/\r?\n/).forEach(tag));
  child.on("exit", (code) => {
    console.log(`[${label}] завершился с кодом ${code}`);
    shutdown(code ?? 1);
  });
  children.push(child);
}

let down = false;
function shutdown(code = 0) {
  if (down) return;
  down = true;
  for (const c of children) c.kill();
  setTimeout(() => process.exit(code), 300);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run("redis", local("redis-server"), ["--port", "6390", "--bind", "127.0.0.1", "--dir", DATA, "--save", ""]);
run("rest", process.execPath, [path.join(import.meta.dirname, "redis-rest.mjs")], { REDIS_PORT: "6390" });
run("livekit", local("livekit-server"), ["--config", path.join(import.meta.dirname, "livekit.yaml")]);

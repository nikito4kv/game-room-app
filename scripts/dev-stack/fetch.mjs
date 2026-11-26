// Скачивает бинарники для локального стенда в .dev-stack/bin (в git не попадает):
// livekit-server той же версии, что на проде, и Redis для Windows. На Linux/macOS
// Redis берётся системный (redis-server в PATH).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const LIVEKIT_VERSION = "1.13.7"; // как в deploy/compose.yaml
const REDIS_WIN = "5.0.14.1"; // github.com/tporadowski/redis
const ROOT = path.resolve(import.meta.dirname, "../..");
const BIN = path.join(ROOT, ".dev-stack", "bin");
fs.mkdirSync(BIN, { recursive: true });

const win = process.platform === "win32";
const arch = process.arch === "arm64" ? "arm64" : "amd64";
const os = win ? "windows" : process.platform === "darwin" ? "darwin" : "linux";

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

// tar из Windows 10+ (bsdtar) распаковывает и zip, и tar.gz. Путь явный: в Git Bash
// первым в PATH стоит GNU tar, который принимает «D:» за имя удалённого хоста.
const TAR = win ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
const extract = (archive) =>
  execFileSync(TAR, ["-xf", path.basename(archive)], { cwd: BIN, stdio: "inherit" });

const lk = path.join(BIN, win ? "livekit-server.exe" : "livekit-server");
if (!fs.existsSync(lk)) {
  const name = `livekit_${LIVEKIT_VERSION}_${os}_${arch}.${win ? "zip" : "tar.gz"}`;
  const archive = path.join(BIN, name);
  console.log(`livekit-server ${LIVEKIT_VERSION}…`);
  await download(`https://github.com/livekit/livekit/releases/download/v${LIVEKIT_VERSION}/${name}`, archive);
  extract(archive);
  fs.rmSync(archive);
}

if (win && !fs.existsSync(path.join(BIN, "redis-server.exe"))) {
  const name = `Redis-x64-${REDIS_WIN}.zip`;
  const archive = path.join(BIN, name);
  console.log(`redis ${REDIS_WIN} для Windows…`);
  await download(`https://github.com/tporadowski/redis/releases/download/v${REDIS_WIN}/${name}`, archive);
  extract(archive);
  fs.rmSync(archive);
}
console.log(`готово: ${BIN}`);

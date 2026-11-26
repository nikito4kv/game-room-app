// deploy/redis-aof.sh: включение журнала Redis перед пересозданием контейнера.
// docker подменён скриптом-заглушкой в PATH; нужен bash (на Windows — Git Bash).
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Каждый запуск bash на Windows медленный, а прогон идёт параллельно с остальными тестами.
vi.setConfig({ testTimeout: 30_000 });

const SCRIPT = path.resolve(__dirname, "../../../deploy/redis-aof.sh");
const GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe";
const BASH = process.platform === "win32" && existsSync(GIT_BASH) ? GIT_BASH : "bash";
const hasBash = spawnSync(BASH, ["-c", "true"]).status === 0;

const FAKE_DOCKER = `#!/usr/bin/env bash
echo "$*" >> "$FAKE_DIR/log"
case "$1 $2" in
  "compose ps") echo "$FAKE_CID" ;;
  "inspect -f") echo "$FAKE_RUNNING" ;;
  exec\\ *)
    shift 3
    case "$1 $2" in
      "CONFIG GET") printf 'appendonly\\r\\n%s\\r\\n' "$FAKE_MODE" ;;
      "CONFIG SET") echo "\${FAKE_SET_REPLY:-OK}" ;;
      "INFO persistence")
        n=$(cat "$FAKE_DIR/n" 2>/dev/null || echo 0)
        echo $((n + 1)) > "$FAKE_DIR/n"
        if [ "$n" -lt "\${FAKE_BUSY:-0}" ]; then p=1; else p=0; fi
        printf 'aof_rewrite_in_progress:%s\\r\\naof_rewrite_scheduled:0\\r\\naof_last_bgrewrite_status:%s\\r\\n' "$p" "\${FAKE_STATUS:-ok}"
        ;;
    esac
    ;;
esac
`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "aof-"));
  writeFileSync(path.join(dir, "docker"), FAKE_DOCKER, { mode: 0o755 });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(env: Record<string, string>) {
  // PATH для bash: каталог заглушки первым (в POSIX-виде для Git Bash).
  const posixDir = process.platform === "win32" ? dir.replace(/^([A-Za-z]):/, (_, d: string) => `/${d.toLowerCase()}`).replace(/\\/g, "/") : dir;
  const r = spawnSync(BASH, ["-c", `export PATH="${posixDir}:$PATH"; bash "$0"`, SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, FAKE_DIR: dir, AOF_POLL_SEC: "0", AOF_WAIT_SEC: "5", ...env },
  });
  const log = existsSync(path.join(dir, "log")) ? readFileSync(path.join(dir, "log"), "utf8") : "";
  return { status: r.status, out: `${r.stdout}${r.stderr}`, log };
}

describe.skipIf(!hasBash)("включение журнала Redis перед up", () => {
  it("Redis не запущен (первый запуск) — пропуск", () => {
    const r = run({ FAKE_CID: "" });
    expect(r.status).toBe(0);
    expect(r.log).not.toContain("CONFIG");
  });

  it("журнал уже включён — ничего не трогает", () => {
    const r = run({ FAKE_CID: "c1", FAKE_RUNNING: "true", FAKE_MODE: "yes" });
    expect(r.status).toBe(0);
    expect(r.log).not.toContain("CONFIG SET");
  });

  it("журнал выключен — CONFIG SET и ожидание конца перезаписи", () => {
    const r = run({ FAKE_CID: "c1", FAKE_RUNNING: "true", FAKE_MODE: "no", FAKE_BUSY: "3" });
    expect(r.status).toBe(0);
    expect(r.log).toContain("CONFIG SET appendonly yes");
    expect(r.log.match(/INFO persistence/g)).toHaveLength(4);
  });

  it("перезапись с ошибкой, не дождались или контейнер стоит — обновление прерывается", () => {
    expect(run({ FAKE_CID: "c1", FAKE_RUNNING: "true", FAKE_MODE: "no", FAKE_STATUS: "err" }).status).toBe(1);
    expect(run({ FAKE_CID: "c1", FAKE_RUNNING: "true", FAKE_MODE: "no", FAKE_BUSY: "100" }).status).toBe(1);
    expect(run({ FAKE_CID: "c1", FAKE_RUNNING: "true", FAKE_MODE: "no", FAKE_SET_REPLY: "ERR" }).status).toBe(1);
    expect(run({ FAKE_CID: "c1", FAKE_RUNNING: "false" }).status).toBe(1);
  });
});

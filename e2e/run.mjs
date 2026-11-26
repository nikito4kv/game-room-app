// Сквозные проверки Game Room на локальном стенде: живые «люди» в системном
// Chrome (фейковые микрофон с речью и захват экрана) заходят в комнату через
// лобби и проверяют голос, рацию, чат, демонстрацию, права хоста и живучесть.
//
//   node e2e/run.mjs [http://localhost:3000] [--only=join,voice] [--skip=restart] [--headed]
//   npm run e2e -- http://localhost:3131 --only=chat
//
// Нужны: стенд (npm run stack), сайт по адресу (дев или `next start`), системный
// Chrome. Каждый сценарий сам создаёт себе комнату. Скриншоты при сбое и
// report.json — в .tmp/e2e/<время>/. Код выхода 1, если что-то упало.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib/env.mjs";
import { SkipError, createContext, launchBrowser } from "./lib/harness.mjs";
import { preflight } from "./lib/stand.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).split(",").filter(Boolean) : null;
};
const base = (args.find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/+$/, "");
const only = flag("only");
const skip = flag("skip") ?? [];
const headed = args.includes("--headed");

const dir = path.join(ROOT, "e2e", "scenarios");
const all = [];
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".mjs")).sort()) {
  const mod = await import(pathToFileURL(path.join(dir, file)).href);
  all.push({ file, ...mod.default });
}
// Имя сценария или номер файла: --only=voice, --only=2, --only=07b.
const matches = (s, key) => s.id === key || s.file.split("-")[0] === key.padStart(2, "0");
const chosen = all.filter((s) => (!only || only.some((k) => matches(s, k))) && !skip.some((k) => matches(s, k)));

if (args.includes("--list")) {
  for (const s of all) console.log(`${s.file.split("-")[0].padEnd(4)} ${s.id.padEnd(12)} ${s.title}`);
  process.exit(0);
}
if (!chosen.length) {
  console.error(`Нет сценариев под выбор. Есть: ${all.map((s) => s.id).join(", ")}`);
  process.exit(2);
}
const problem = await preflight(base);
if (problem) {
  console.error(`Стенд не готов: ${problem}`);
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const out = path.join(ROOT, ".tmp", "e2e", stamp);
fs.mkdirSync(out, { recursive: true });
console.log(`Сайт ${base}, сценариев: ${chosen.length}. Снимки и отчёт: ${path.relative(ROOT, out)}`);

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}: не уложился в ${ms / 1000} с`)), ms)),
  ]);

const summary = [];
for (const [i, s] of chosen.entries()) {
  console.log(`\n━━ ${i + 1}/${chosen.length} ${s.id} — ${s.title}`);
  const started = Date.now();
  const browser = await launchBrowser({ headed });
  const t = createContext({ id: s.id, base, browser, out });
  let error = null;
  let skipped = null;
  try {
    await withTimeout(s.run(t), s.timeoutMs ?? 6 * 60_000, s.id);
  } catch (e) {
    if (e instanceof SkipError) {
      skipped = e.message;
      console.log(`  —    пропущен: ${skipped}`);
    } else {
      error = e instanceof Error ? e.message.split("\n")[0] : String(e);
      console.log(`  FAIL сценарий прервался: ${error}`);
      for (const p of t.people) await p.shot(`fail-${p.name}`);
    }
  }
  for (const p of t.people) {
    const errs = p.realErrors();
    if (errs.length) console.log(`  !    консоль ${p.name}: ${errs.slice(0, 4).join(" | ").slice(0, 400)}`);
  }
  for (const p of t.people) await p.close();
  await browser.close().catch(() => {});
  const failed = t.results.filter((r) => !r.ok);
  const ok = !error && failed.length === 0;
  const sec = Math.round((Date.now() - started) / 1000);
  summary.push({
    id: s.id,
    title: s.title,
    ok,
    skipped,
    passed: t.results.length - failed.length,
    total: t.results.length,
    sec,
    error,
    failed: failed.map((f) => `${f.label}${f.extra ? ` — ${f.extra}` : ""}`),
    notes: t.notes,
    consoleErrors: Object.fromEntries(t.people.map((p) => [p.name, p.realErrors()])),
  });
  const verdict = skipped ? "ПРОПУЩЕН" : ok ? "ПРОШЁЛ" : "УПАЛ";
  console.log(`  ⇒ ${verdict} (${t.results.length - failed.length}/${t.results.length}, ${sec} с)`);
}

console.log("\nИТОГ");
for (const r of summary) {
  const verdict = r.skipped ? "пропущен" : r.ok ? "прошёл" : "УПАЛ";
  console.log(
    `  ${r.id.padEnd(12)} ${verdict.padEnd(8)} ${`${r.passed}/${r.total}`.padStart(6)}  ${String(r.sec).padStart(4)} с  ${r.title}`,
  );
  for (const f of r.failed) console.log(`      ✗ ${f}`);
  if (r.error) console.log(`      ✗ ${r.error}`);
  if (r.skipped) console.log(`      — ${r.skipped}`);
}
const failedCount = summary.filter((r) => !r.ok).length;
const skippedCount = summary.filter((r) => r.skipped).length;
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify({ base, startedAt: stamp, summary }, null, 2));
console.log(
  `\nПрошло ${summary.length - failedCount - skippedCount}, упало ${failedCount}, пропущено ${skippedCount}. ` +
    `Отчёт: ${path.relative(ROOT, path.join(out, "report.json"))}`,
);
process.exit(failedCount ? 1 : 0);

// Собирает готовый набор звуков соундборда: sounds-src/*.{mp3,ogg,wav,m4a} → public/sounds/ + pack.json.
// Запуск: npm run sounds:pack [папка]. Подробности — sounds-src/README.md.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const src = path.resolve(root, process.argv[2] ?? "sounds-src");
const out = path.join(root, "public", "sounds");
const MAX_BYTES = 300 * 1024;
const EXT = new Set([".mp3", ".ogg", ".wav", ".m4a"]);

const TRANSLIT = Object.fromEntries(
  Object.entries({
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l",
    м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh",
    щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  }),
);

/** Имя звука для сети: латиница, цифры, дефис; 2–32 символа (isSoundId в контракте). */
function slug(name) {
  const s = [...name.toLowerCase()]
    .map((c) => TRANSLIT[c] ?? c)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return s.length >= 2 ? s : `sound-${s || "x"}`;
}

/** Название на кнопке: имя файла без расширения, подчёркивания и дефисы — пробелами, первая буква заглавная. */
function title(name) {
  const t = name.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, 24);
}

if (!fs.existsSync(src)) {
  console.error(`Нет папки ${src}. Создайте её и положите туда звуки.`);
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });
// Прежний набор убираем целиком: удалённый из папки звук не должен остаться на сайте.
for (const f of fs.readdirSync(out)) if (f !== "pack.json" && EXT.has(path.extname(f).toLowerCase())) fs.rmSync(path.join(out, f));

const files = fs.readdirSync(src).filter((f) => EXT.has(path.extname(f).toLowerCase())).sort((a, b) => a.localeCompare(b, "ru"));
const used = new Set();
const sounds = [];
for (const f of files) {
  const base = path.basename(f, path.extname(f));
  let id = slug(base);
  for (let n = 2; used.has(id); n++) id = `${slug(base).slice(0, 28)}-${n}`;
  used.add(id);
  const size = fs.statSync(path.join(src, f)).size;
  if (size > MAX_BYTES) console.warn(`  ! ${f}: ${(size / 1024).toFixed(0)} КБ — больше ${MAX_BYTES / 1024} КБ, обрежьте (в комнатах такой звук не загрузят)`);
  const file = `${id}${path.extname(f).toLowerCase()}`;
  fs.copyFileSync(path.join(src, f), path.join(out, file));
  sounds.push({ id, name: title(base), file });
}
fs.writeFileSync(path.join(out, "pack.json"), `${JSON.stringify({ sounds }, null, 2)}\n`);
console.log(`Набор: ${sounds.length} звуков → public/sounds/pack.json`);
for (const s of sounds) console.log(`  ${s.id.padEnd(24)} ${s.name}`);

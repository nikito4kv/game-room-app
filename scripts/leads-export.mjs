// Выгрузка заявок-диалогов с сайта из Redis в CSV (запасной путь: основной — ящик
// заявок в админке).
//
// Заявки пишет POST /api/leads: gr:lead:<id> (JSON) и индекс gr:leads
// (src/lib/platform/leadThreads.ts). Старые заявки leads:v1 переносятся туда же
// при первом открытии ящика в админке. Скрипт только читает и ничего не меняет.
//
// Запуск (подхватывает .env.local, как analytics:export):
//   node --env-file=.env.local scripts/leads-export.mjs                 CSV в консоль
//   node --env-file=.env.local scripts/leads-export.mjs --out=leads.csv CSV в файл
//   node --env-file=.env.local scripts/leads-export.mjs --excel         ; и BOM: Excel откроет русский текст без плясок
//   node --env-file=.env.local scripts/leads-export.mjs --json          сырые записи
//   node --env-file=.env.local scripts/leads-export.mjs --summary       только сводка: сколько и каких
//
// Нужны env: UPSTASH_REDIS_REST_URL и UPSTASH_REDIS_REST_TOKEN (те же, что у сайта).
// В выгрузке — контакты людей. Не коммитьте файл и не пересылайте открытым текстом.
import { writeFile } from "node:fs/promises";

const INDEX = "gr:leads";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const URL_ = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!URL_ || !TOKEN) {
  console.error(
    "Не заданы UPSTASH_REDIS_REST_URL и/или UPSTASH_REDIS_REST_TOKEN.\n" +
      "Запустите так: node --env-file=.env.local scripts/leads-export.mjs",
  );
  process.exit(1);
}

/** Одна команда Redis через REST (протокол Upstash и прослойки serverless-redis-http). */
async function redis(...command) {
  const res = await fetch(URL_.replace(/\/+$/, ""), {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(`Redis ${res.status}: ${body.error ?? "нет ответа"}`);
  return body.result;
}

/** Ячейка CSV: кавычки, разделитель и защита от «формул» в Excel (=, +, -, @(…)). */
function cell(value, sep) {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-\t\r]/.test(s) || /^@.*\(/.test(s)) s = `'${s}`;
  return s.includes(sep) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const COLUMNS = [
  ["createdAt", "Когда (UTC)"],
  ["kind", "Откуда"],
  ["product", "Что хотят"],
  ["status", "Статус"],
  ["name", "Имя"],
  ["contact", "Контакт"],
  ["clubName", "Клуб"],
  ["city", "Город"],
  ["pcCount", "ПК"],
  ["source", "Источник"],
  ["firstMessage", "Первое сообщение"],
  ["messageCount", "Сообщений"],
  ["updatedAt", "Последнее изменение"],
  ["migrated", "Из старой формы"],
  ["id", "id"],
];

const KIND = { pricing: "тарифы", club: "клубы", event: "событие", other: "другое" };
const PRODUCT = {
  pro: "Pro", club: "Клуб", community: "Сообщество", event: "Событие", pass: "Пропуск",
  gift: "Подарок", support: "Поддержать", other: "Другое",
};
const STATUS = { new: "новая", in_progress: "в работе", answered: "ответили", paying: "платит", closed: "закрыта" };

function parse(raw) {
  try {
    const lead = JSON.parse(raw);
    if (!lead || typeof lead !== "object") return null;
    // Хэш токена личной ссылки в выгрузку не попадает.
    const rest = { ...lead };
    delete rest.tokenHash;
    delete rest.unread;
    const messages = Array.isArray(lead.messages) ? lead.messages : [];
    return {
      ...rest,
      firstMessage: messages[0]?.text ?? "",
      messageCount: messages.length,
      migrated: lead.migrated ? "да" : "",
    };
  } catch {
    return null;
  }
}

// Индекс упорядочен по последнему изменению; в таблице — по порядку прихода.
const ids = await redis("ZRANGE", INDEX, "0", "-1");
const raws = ids.length ? await redis("MGET", ...ids.map((id) => `gr:lead:${id}`)) : [];
const rows = raws.map(parse).filter(Boolean).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

if (flag("json")) {
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

if (flag("summary")) {
  const count = (pick) => {
    const m = new Map();
    for (const r of rows) m.set(pick(r), (m.get(pick(r)) ?? 0) + 1);
    return [...m].map(([k, n]) => `${k}: ${n}`).join(", ") || "нет";
  };
  console.log(`Заявок всего: ${rows.length}`);
  console.log(`По типу: ${count((r) => KIND[r.kind] ?? r.kind)}`);
  console.log(`По продукту: ${count((r) => PRODUCT[r.product] ?? r.product)}`);
  console.log(`По статусу: ${count((r) => STATUS[r.status] ?? r.status)}`);
  if (rows.length) console.log(`Первая: ${rows[0].createdAt}, последняя: ${rows.at(-1).createdAt}`);
  process.exit(0);
}

const sep = flag("excel") ? ";" : ",";
const present = {
  kind: (v) => KIND[v] ?? v,
  product: (v) => PRODUCT[v] ?? v,
  status: (v) => STATUS[v] ?? v,
};
const lines = [
  COLUMNS.map(([, title]) => cell(title, sep)).join(sep),
  ...rows.map((r) => COLUMNS.map(([key]) => cell((present[key] ?? ((v) => v))(r[key]), sep)).join(sep)),
];
const csv = (flag("excel") ? "﻿" : "") + lines.join("\r\n") + "\r\n";

const out = option("out");
if (out) {
  await writeFile(out, csv, "utf8");
  console.error(`Записано заявок: ${rows.length} в ${out}`);
} else {
  process.stdout.write(csv);
}

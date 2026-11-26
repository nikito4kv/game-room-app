// Ник участника: нормализация, проверка и сравнение «похоже ли на чужой».
// Общий модуль сервера и клиента (без серверных импортов): клиент может заранее
// показать ошибку, а сервер всё равно проверяет сам — ему клиент не указ.
import { NAME_MAX_LENGTH, NAME_MIN_LENGTH } from "./contract";

// Вырезаем целиком то, что не рисуется или ломает отображение:
//  • \p{Cc} — управляющие (переводы строк, табуляция, NUL…);
//  • \p{Cf} — форматирующие: нулевой ширины (U+200B–U+200D, U+2060, U+FEFF),
//    направление текста (U+200E/F, U+202A–U+202E, U+2066–U+2069, U+061C),
//    мягкий перенос, теговые символы;
//  • \p{Co} \p{Cs} \p{Cn} — частные, одиночные суррогаты, неназначенные;
//  • \p{Zl} \p{Zp} — разделители строк и абзацев;
//  • «пустые» буквы и знаки, которые рисуются пустотой (хангыль-заполнители,
//    пустой брайль, CGJ, монгольские селекторы) — ими делают «невидимые» ники.
const INVISIBLE =
  /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Cn}\p{Zl}\p{Zp}͏ᅟᅠ឴឵᠋-᠏⠀ㅤﾠ]/gu;
// Больше двух диакритик подряд — «залго»-ник, налезающий на соседние строки.
const EXCESS_MARKS = /(\p{M}{2})\p{M}+/gu;
const SPACES = /[\s\p{Zs}]+/gu;
// Сырой ввод длиннее этого заведомо не станет допустимым ником — не разбираем.
const RAW_LIMIT = 256;

/**
 * Чистит строку для показа (ник, название комнаты): NFKC (полноширинные и «стилизованные» буквы →
 * обычные), без невидимых и управляющих символов, пробелы схлопнуты и обрезаны.
 * Длину не проверяет — для ника это делает checkNickname.
 */
export function cleanDisplayText(raw: string): string {
  // NFKD → чистка → NFC даёт ровно NFKC, но диакритики считаются на разложенной
  // форме: иначе композиция «спрятала» бы одну из них внутрь буквы.
  return raw
    .normalize("NFKD")
    .replace(INVISIBLE, "")
    .replace(EXCESS_MARKS, "$1")
    .normalize("NFC")
    .replace(SPACES, " ")
    .trim();
}

export type NicknameCheck =
  | { ok: true; name: string }
  | { ok: false; reason: "empty" | "too_short" | "too_long" };

/** Нормализует и проверяет длину (в кодовых точках: эмодзи — один символ, а не два). */
export function checkNickname(raw: unknown): NicknameCheck {
  if (typeof raw !== "string") return { ok: false, reason: "empty" };
  if (raw.length > RAW_LIMIT) return { ok: false, reason: "too_long" };
  const name = cleanDisplayText(raw);
  const length = [...name].length;
  if (length === 0) return { ok: false, reason: "empty" };
  if (length < NAME_MIN_LENGTH) return { ok: false, reason: "too_short" };
  if (length > NAME_MAX_LENGTH) return { ok: false, reason: "too_long" };
  return { ok: true, name };
}

// Буквы, которые на экране не отличить от латинских. Сводим к латинице уже ПОСЛЕ
// перевода в нижний регистр, поэтому в таблице и «заглавные» двойники: «в» → «b»,
// потому что «В» неотличима от «B», а регистр мы и так не различаем.
const LOOKALIKES: Record<string, string> = {
  // кириллица
  а: "a", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t",
  у: "y", х: "x", ѕ: "s", і: "i", ј: "j", һ: "h", ԁ: "d", ԛ: "q", ԝ: "w", ӏ: "l", ү: "y",
  // греческий
  α: "a", β: "b", ε: "e", ζ: "z", η: "h", ι: "i", κ: "k", μ: "m", ν: "n", ο: "o",
  ρ: "p", τ: "t", υ: "y", χ: "x",
};
const LOOKALIKE_RE = new RegExp(`[${Object.keys(LOOKALIKES).join("")}]`, "gu");

/**
 * Ключ сравнения ников: «Вася», «ВАСЯ», «Bася» (латинская B) и «Вася» с
 * невидимым символом дают один ключ. Без диакритики (ё = е, й = и) и регистра.
 * Ложные совпадения не страшны: ключ нужен только для «ник занят» среди
 * присутствующих, а в ответ сервер сразу предлагает свободный вариант.
 */
export function nicknameKey(name: string): string {
  return cleanDisplayText(name)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(LOOKALIKE_RE, (ch) => LOOKALIKES[ch] ?? ch);
}

/**
 * Свободный вариант ника для подсказки «ник занят»: «Вася 2», «Вася 3»…
 * Хвостовой номер исходного ника не наращивается дважды («Вася 2» → «Вася 3»).
 * isTaken получает кандидата и решает, занят ли он (обычно через nicknameKey).
 */
export function suggestNickname(name: string, isTaken: (candidate: string) => boolean): string {
  const base = [...cleanDisplayText(name).replace(/\s\d{1,2}$/u, "")];
  for (let n = 2; n < 100; n++) {
    const suffix = ` ${n}`;
    const head = base.slice(0, NAME_MAX_LENGTH - suffix.length).join("").trimEnd();
    const candidate = `${head}${suffix}`;
    if (!isTaken(candidate)) return candidate;
  }
  // 98 «Вась» в одной комнате невозможны (максимум участников — 10), но ответ
  // всё равно должен быть: случайный хвост.
  const suffix = ` ${100 + Math.floor(Math.random() * 900)}`;
  return `${base.slice(0, NAME_MAX_LENGTH - suffix.length).join("").trimEnd()}${suffix}`;
}

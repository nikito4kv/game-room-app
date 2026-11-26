// Заявки с сайта: «позвать меня, когда запустите» (страница тарифов) и заявка
// клуба на бесплатный пилот. Модуль чистый: ту же проверку гоняют форма в
// браузере (подсказки у полей) и сервер (POST /api/leads, там ей и верим).
// Хранение в Redis — leadsStore.ts (только сервер).

import {
  LEAD_PRODUCTS,
  LEAD_THREAD_KINDS,
  type LeadProduct,
  type LeadThreadKind,
} from "@/lib/api/platform";

export const LEAD_KINDS = ["waitlist", "club_pilot"] as const;
export type LeadKind = (typeof LEAD_KINDS)[number];

/** Что человек выбрал на странице тарифов: Pro, Клуб или «хочу поддержать». */
export const LEAD_TIERS = ["pro", "club", "support"] as const;
export type LeadTier = (typeof LEAD_TIERS)[number];

/** «Кто вы» из формы листа ожидания. В заявке клуба роль всегда «club». */
export const LEAD_ROLES = ["friends", "community", "club", "other"] as const;
export type LeadRole = (typeof LEAD_ROLES)[number];

export const LEAD_ROLE_LABELS: Record<LeadRole, string> = {
  friends: "Играю с друзьями",
  community: "Веду комьюнити или стримлю",
  club: "Клуб или киберарена",
  other: "Другое",
};

export type LeadContactType = "email" | "telegram" | "vk" | "handle" | "other";

export const LEAD_LIMITS = {
  contactMin: 3,
  contactMax: 120,
  noteMax: 300,
  clubNameMax: 80,
  cityMax: 60,
  pcMin: 1,
  pcMax: 1000,
} as const;

/** Ключ в Redis: список заявок, новые слева. Версия в имени — на случай смены формата. */
export const LEADS_KEY = "leads:v1";

/** События аналитики. В свойствах — только тип и тариф, никаких контактов. */
export const LEAD_EVENTS = {
  pricingViewed: "pricing_viewed",
  leadSubmitted: "lead_submitted",
} as const;

/** Что присылает форма. Поля необязательные: форма отдаёт «как есть», проверка — ниже. */
export type LeadInput = {
  kind?: unknown;
  tier?: unknown;
  contact?: unknown;
  role?: unknown;
  clubName?: unknown;
  city?: unknown;
  pcCount?: unknown;
  note?: unknown;
  consent?: unknown;
};

/** Проверенная и очищенная заявка. */
export type Lead = {
  kind: LeadKind;
  /** waitlist: что нажали; club_pilot: всегда «club». */
  tier: LeadTier;
  contact: string;
  contactType: LeadContactType;
  role: LeadRole;
  clubName: string | null;
  city: string | null;
  pcCount: number | null;
  note: string | null;
  consent: true;
};

/** Запись в Redis: заявка + служебные поля. IP и User-Agent не храним. */
export type StoredLead = Lead & { id: string; at: string };

export type LeadField =
  | "kind"
  | "tier"
  | "contact"
  | "role"
  | "clubName"
  | "city"
  | "pcCount"
  | "note"
  | "consent";
export type LeadErrors = Partial<Record<LeadField | "form", string>>;

export type LeadResult = { ok: true; lead: Lead } | { ok: false; errors: LeadErrors };

/** Тело ответа POST /api/leads при отказе. fields — ошибки по полям для формы. */
export type LeadErrorBody = {
  error: { code: string; message: string; fields?: LeadErrors; retryAfterSec?: number };
};

// ── Очистка текста ────────────────────────────────────────────────────────────

// Управляющие символы (кроме \n в многострочном тексте), нулевой ширины и
// направления текста: в CSV и в таблицах они ломают вид, а нужны только для обмана.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩﻿]/g;

function codePoints(s: string): number {
  return [...s].length;
}

/** Одна строка: управляющие символы долой, пробелы схлопнуты. */
export function cleanLine(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(CONTROL, "").replace(/\s+/g, " ").trim();
}

/** Короткий текст с абзацами: не больше одной пустой строки подряд. */
export function cleanNote(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Контакт ───────────────────────────────────────────────────────────────────

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;
// Телефон нам не нужен: меньше чужих данных — меньше забот. Узнаём «цифры, плюс,
// скобки, дефисы» без единой буквы.
const PHONE_LIKE = /^\+?[\d\s().-]{7,}$/;

/** Тип контакта по виду строки. Нужен только для выгрузки: «куда писать». */
export function contactTypeOf(contact: string): LeadContactType {
  if (EMAIL.test(contact)) return "email";
  if (/t\.me\/|telegram|телеграм|(^|\s)(тг|tg)(\s|:|$)/i.test(contact)) return "telegram";
  if (/vk\.(com|ru)|вконтакте|(^|\s)(vk|вк)(\s|:|$)/i.test(contact)) return "vk";
  if (/^@/.test(contact)) return "handle";
  return "other";
}

function checkContact(raw: unknown): { value: string; type: LeadContactType } | string {
  const contact = cleanLine(raw);
  if (!contact) return "Укажите, как с вами связаться";
  if (codePoints(contact) < LEAD_LIMITS.contactMin) {
    return `Слишком короткий контакт: нужно хотя бы ${LEAD_LIMITS.contactMin} символа`;
  }
  if (codePoints(contact) > LEAD_LIMITS.contactMax) {
    return `Слишком длинный контакт: не больше ${LEAD_LIMITS.contactMax} символов`;
  }
  if (/[<>]/.test(contact)) return "В контакте лишние символы. Нужен e-mail или ник";
  if (PHONE_LIKE.test(contact)) return "Телефон не нужен. Оставьте e-mail или ник в VK или Telegram";
  // «@» посреди слова и без пробелов: человек хотел написать e-mail, но ошибся.
  if (/^[^\s@]+@[^\s@]*$/.test(contact) && !EMAIL.test(contact)) {
    return "Проверьте e-mail: похоже, в нём опечатка";
  }
  return { value: contact, type: contactTypeOf(contact) };
}

// ── Проверка заявки ───────────────────────────────────────────────────────────

function isOneOf<T extends string>(list: readonly T[], x: unknown): x is T {
  return typeof x === "string" && (list as readonly string[]).includes(x);
}

function optionalLine(raw: unknown, max: number, tooLong: string): { value: string | null } | { error: string } {
  const s = cleanLine(raw);
  if (!s) return { value: null };
  if (codePoints(s) > max) return { error: tooLong };
  return { value: s };
}

/**
 * Проверка заявки. Ошибки — по полям, готовый русский текст для подсказки под
 * полем. Неизвестные поля игнорируются; лишнее (IP, заголовки) мы не читаем.
 */
export function validateLead(input: unknown): LeadResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: { form: "Некорректный запрос" } };
  }
  const raw = input as LeadInput;
  const errors: LeadErrors = {};

  const kind = isOneOf(LEAD_KINDS, raw.kind) ? raw.kind : null;
  if (!kind) errors.kind = "Неизвестный тип заявки";
  const pilot = kind === "club_pilot";

  let tier: LeadTier | null = null;
  if (pilot) {
    tier = "club";
  } else if (kind) {
    if (isOneOf(LEAD_TIERS, raw.tier)) tier = raw.tier;
    else errors.tier = "Выберите тариф";
  }

  let role: LeadRole | null = null;
  if (pilot) {
    role = "club";
  } else if (kind) {
    if (isOneOf(LEAD_ROLES, raw.role)) role = raw.role;
    else errors.role = "Выберите, кто вы";
  }

  let contact = "";
  let contactType: LeadContactType = "other";
  const c = checkContact(raw.contact);
  if (typeof c === "string") errors.contact = c;
  else {
    contact = c.value;
    contactType = c.type;
  }

  // Клуб: название, город и число ПК нужны только в заявке на пилот.
  let clubName: string | null = null;
  const name = optionalLine(raw.clubName, LEAD_LIMITS.clubNameMax, `Название длиннее ${LEAD_LIMITS.clubNameMax} символов`);
  if ("error" in name) errors.clubName = name.error;
  else {
    clubName = name.value;
    if (pilot && !clubName) errors.clubName = "Напишите название клуба";
  }

  let city: string | null = null;
  const town = optionalLine(raw.city, LEAD_LIMITS.cityMax, `Город длиннее ${LEAD_LIMITS.cityMax} символов`);
  if ("error" in town) errors.city = town.error;
  else {
    city = town.value;
    if (pilot && !city) errors.city = "Напишите город";
  }

  let pcCount: number | null = null;
  const pcRaw = typeof raw.pcCount === "string" ? raw.pcCount.trim() : raw.pcCount;
  if (pcRaw !== undefined && pcRaw !== null && pcRaw !== "") {
    const n = typeof pcRaw === "number" ? pcRaw : /^\d{1,5}$/.test(String(pcRaw)) ? Number(pcRaw) : NaN;
    if (!Number.isInteger(n) || n < LEAD_LIMITS.pcMin || n > LEAD_LIMITS.pcMax) {
      errors.pcCount = `Число ПК — от ${LEAD_LIMITS.pcMin} до ${LEAD_LIMITS.pcMax}`;
    } else {
      pcCount = n;
    }
  } else if (pilot) {
    errors.pcCount = "Укажите, сколько в клубе ПК";
  }

  let note: string | null = null;
  const text = cleanNote(raw.note);
  if (text) {
    if (codePoints(text) > LEAD_LIMITS.noteMax) {
      errors.note = `Слишком длинно: не больше ${LEAD_LIMITS.noteMax} символов`;
    } else {
      note = text;
    }
  }

  if (raw.consent !== true) errors.consent = "Нужно согласие на обработку контакта";

  if (Object.keys(errors).length > 0 || !kind || !tier || !role) return { ok: false, errors };

  return {
    ok: true,
    lead: { kind, tier, contact, contactType, role, clubName, city, pcCount, note, consent: true },
  };
}

// ── Заявки-диалоги (А5): POST /api/leads по контракту LeadCreateRequest ──────────
// Прежняя форма (validateLead выше) остаётся только для разбора старых заявок
// leads:v1 при переносе; новые формы шлют LeadCreateRequest.

export const LEAD_THREAD_LIMITS = {
  nameMax: 60,
  messageMax: 2000,
  sourceMax: 200,
} as const;

export type LeadCreateField =
  | "kind"
  | "product"
  | "name"
  | "message"
  | "contact"
  | "clubName"
  | "city"
  | "pcCount"
  | "consent";
export type LeadCreateErrors = Partial<Record<LeadCreateField | "form", string>>;

/** Проверенная новая заявка (поля как в LeadCreateRequest, пустое — null). */
export type ValidLeadCreate = {
  kind: LeadThreadKind;
  product: LeadProduct;
  name: string;
  message: string;
  contact: string | null;
  clubName: string | null;
  city: string | null;
  pcCount: number | null;
  source: string | null;
};

/** Текст сообщения в диалоге заявки: те же правила, что у заметки, своя длина. */
export function checkLeadMessage(raw: unknown): { ok: true; text: string } | { ok: false; message: string } {
  const text = cleanNote(raw);
  if (!text) return { ok: false, message: "Напишите сообщение" };
  if (codePoints(text) > LEAD_THREAD_LIMITS.messageMax) {
    return { ok: false, message: `Слишком длинно: не больше ${LEAD_THREAD_LIMITS.messageMax} символов` };
  }
  return { ok: true, text };
}

/**
 * Проверка новой заявки (браузер — для подсказок, сервер — всерьёз). Контакт
 * необязателен (решение 05.10.2026), но если указан — должен быть похож на контакт.
 */
export function validateLeadCreate(
  input: unknown,
): { ok: true; lead: ValidLeadCreate } | { ok: false; errors: LeadCreateErrors } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: { form: "Некорректный запрос" } };
  }
  const raw = input as Record<string, unknown>;
  const errors: LeadCreateErrors = {};

  const kind = isOneOf(LEAD_THREAD_KINDS, raw.kind) ? raw.kind : null;
  if (!kind) errors.kind = "Неизвестный тип заявки";
  const product = isOneOf(Object.keys(LEAD_PRODUCTS) as LeadProduct[], raw.product) ? raw.product : null;
  if (!product) errors.product = "Выберите, что вас интересует";

  const name = cleanLine(raw.name);
  if (!name) errors.name = "Напишите имя или ник";
  else if (codePoints(name) > LEAD_THREAD_LIMITS.nameMax) {
    errors.name = `Имя длиннее ${LEAD_THREAD_LIMITS.nameMax} символов`;
  }

  const msg = checkLeadMessage(raw.message);
  if (!msg.ok) errors.message = msg.message;

  let contact: string | null = null;
  if (cleanLine(raw.contact)) {
    const c = checkContact(raw.contact);
    if (typeof c === "string") errors.contact = c;
    else contact = c.value;
  }

  let clubName: string | null = null;
  const club = optionalLine(raw.clubName, LEAD_LIMITS.clubNameMax, `Название длиннее ${LEAD_LIMITS.clubNameMax} символов`);
  if ("error" in club) errors.clubName = club.error;
  else clubName = club.value;

  let city: string | null = null;
  const town = optionalLine(raw.city, LEAD_LIMITS.cityMax, `Город длиннее ${LEAD_LIMITS.cityMax} символов`);
  if ("error" in town) errors.city = town.error;
  else city = town.value;

  let pcCount: number | null = null;
  const pcRaw = typeof raw.pcCount === "string" ? raw.pcCount.trim() : raw.pcCount;
  if (pcRaw !== undefined && pcRaw !== null && pcRaw !== "") {
    const n = typeof pcRaw === "number" ? pcRaw : /^\d{1,5}$/.test(String(pcRaw)) ? Number(pcRaw) : NaN;
    if (!Number.isInteger(n) || n < LEAD_LIMITS.pcMin || n > LEAD_LIMITS.pcMax) {
      errors.pcCount = `Число ПК — от ${LEAD_LIMITS.pcMin} до ${LEAD_LIMITS.pcMax}`;
    } else {
      pcCount = n;
    }
  }

  if (raw.consent !== true) errors.consent = "Нужно согласие на обработку данных";

  const sourceLine = cleanLine(raw.source);
  const source = sourceLine ? sourceLine.slice(0, LEAD_THREAD_LIMITS.sourceMax) : null;

  if (Object.keys(errors).length > 0 || !kind || !product || !msg.ok) return { ok: false, errors };
  return { ok: true, lead: { kind, product, name, message: msg.text, contact, clubName, city, pcCount, source } };
}

// Форма заявки (А5) на клиенте: проверка полей до отправки (подсказки у полей
// сразу, без похода на сервер) и сборка тела POST /api/leads по контракту
// LeadCreateRequest. Последнее слово — за сервером: его ошибки по полям форма
// показывает так же (ApiError.fields).
import {
  LEAD_PRODUCTS,
  type LeadCreateRequest,
  type LeadProduct,
  type LeadThreadKind,
} from "@/lib/api/platform";

/** Пределы полей (в кодовых точках, как считает сервер). */
export const LEAD_FORM_LIMITS = {
  nameMax: 60,
  messageMax: 2000,
  contactMax: 120,
  clubNameMax: 80,
  cityMax: 60,
  pcMin: 1,
  pcMax: 1000,
} as const;

export type LeadFormField = "product" | "name" | "message" | "contact" | "clubName" | "city" | "pcCount" | "consent";
export type LeadFormErrors = Partial<Record<LeadFormField, string>>;

/** Порядок полей на экране сверху вниз: фокус при ошибке — на самое верхнее неверное. */
export const LEAD_FIELD_ORDER: readonly LeadFormField[] = [
  "product",
  "name",
  "message",
  "contact",
  "clubName",
  "city",
  "pcCount",
  "consent",
];

/** Что в форме сейчас (как напечатано). */
export type LeadFormValues = {
  product: LeadProduct;
  name: string;
  message: string;
  contact: string;
  clubName: string;
  city: string;
  pcCount: string;
  consent: boolean;
};

const len = (s: string) => [...s].length;

/** Вид заявки по продукту: клуб — club, событие — event, «другое» — other, остальное платное — pricing. */
export function kindForProduct(product: LeadProduct): LeadThreadKind {
  if (product === "club") return "club";
  if (product === "event") return "event";
  if (product === "other") return "other";
  return "pricing";
}

export function isLeadProduct(x: unknown): x is LeadProduct {
  return typeof x === "string" && Object.prototype.hasOwnProperty.call(LEAD_PRODUCTS, x);
}

/** Поля клуба нужны только для клуба (и события в клубе) — у остальных их не показываем. */
export function showsClubFields(product: LeadProduct): boolean {
  return product === "club" || product === "event";
}

export type LeadFormCheck = { ok: true; request: LeadCreateRequest } | { ok: false; errors: LeadFormErrors };

/** Проверка и сборка тела запроса. Пустые необязательные поля в тело не попадают. */
export function checkLeadForm(v: LeadFormValues, source?: string): LeadFormCheck {
  const errors: LeadFormErrors = {};
  const name = v.name.trim();
  const message = v.message.trim();
  const contact = v.contact.trim();
  const club = showsClubFields(v.product);
  const clubName = club ? v.clubName.trim() : "";
  const city = club ? v.city.trim() : "";
  const pcRaw = club ? v.pcCount.trim() : "";

  if (!isLeadProduct(v.product)) errors.product = "Выберите, что вас интересует";
  if (!name) errors.name = "Напишите, как к вам обращаться";
  else if (len(name) > LEAD_FORM_LIMITS.nameMax) errors.name = `Не длиннее ${LEAD_FORM_LIMITS.nameMax} символов`;
  if (!message) errors.message = "Напишите пару слов: что вам нужно или какой вопрос";
  else if (len(message) > LEAD_FORM_LIMITS.messageMax) {
    errors.message = `Слишком длинно: не больше ${LEAD_FORM_LIMITS.messageMax} символов`;
  }
  if (contact && len(contact) > LEAD_FORM_LIMITS.contactMax) {
    errors.contact = `Не длиннее ${LEAD_FORM_LIMITS.contactMax} символов`;
  }
  if (clubName && len(clubName) > LEAD_FORM_LIMITS.clubNameMax) {
    errors.clubName = `Не длиннее ${LEAD_FORM_LIMITS.clubNameMax} символов`;
  }
  if (city && len(city) > LEAD_FORM_LIMITS.cityMax) errors.city = `Не длиннее ${LEAD_FORM_LIMITS.cityMax} символов`;
  let pcCount: number | undefined;
  if (pcRaw) {
    const n = /^\d{1,5}$/.test(pcRaw) ? Number(pcRaw) : NaN;
    if (!Number.isInteger(n) || n < LEAD_FORM_LIMITS.pcMin || n > LEAD_FORM_LIMITS.pcMax) {
      errors.pcCount = `Число от ${LEAD_FORM_LIMITS.pcMin} до ${LEAD_FORM_LIMITS.pcMax}`;
    } else {
      pcCount = n;
    }
  }
  if (!v.consent) errors.consent = "Нужно согласие, иначе мы не сможем принять заявку";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    request: {
      kind: kindForProduct(v.product),
      product: v.product,
      name,
      message,
      ...(contact ? { contact } : {}),
      ...(clubName ? { clubName } : {}),
      ...(city ? { city } : {}),
      ...(pcCount !== undefined ? { pcCount } : {}),
      consent: true,
      ...(source ? { source } : {}),
    },
  };
}

/** Ошибки сервера по полям → ошибки формы (неизвестные поля — в общий текст). */
export function serverFieldErrors(fields: Record<string, string> | undefined): {
  errors: LeadFormErrors;
  rest: string | null;
} {
  const errors: LeadFormErrors = {};
  const rest: string[] = [];
  for (const [k, v] of Object.entries(fields ?? {})) {
    if ((LEAD_FIELD_ORDER as readonly string[]).includes(k)) errors[k as LeadFormField] = v;
    else rest.push(v);
  }
  return { errors, rest: rest.length > 0 ? rest.join(". ") : null };
}

/** Источник заявки для команды: utm-метки из адреса страницы, если есть. */
export function leadSource(search: string): string | undefined {
  const p = new URLSearchParams(search);
  const parts = ["utm_source", "utm_medium", "utm_campaign"]
    .map((k) => p.get(k)?.trim())
    .filter((v): v is string => !!v)
    .map((v) => v.slice(0, 60));
  return parts.length > 0 ? parts.join(" / ") : undefined;
}

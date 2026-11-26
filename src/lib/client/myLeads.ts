// «Мои заявки»: личные ссылки на заявки-диалоги (А5), которые человек отправил
// с этого браузера. Пишет форма заявки после отправки, читают шапка сайта (метка
// «Есть ответ») и страница /request/<id> (токен, если в адресе его нет).
//
// Хранится в localStorage этого браузера. Токен — ключ к переписке: его знает
// только автор, поэтому он лежит здесь, а не в адресах аналитики.
import { readLocalJSON, writeLocalJSON } from "@/lib/clientStorage";
import type { LeadProduct } from "@/lib/api/platform";

export type MyLead = {
  id: string;
  /** Токен доступа к переписке (?t=). */
  t: string;
  /** Личная ссылка вида /request/<id>?t=<token> (как её отдал сервер). */
  url: string;
  product: LeadProduct | null;
  /** Когда отправлена (Date.now()). */
  createdAt: number;
};

const MY_LEADS_KEY = "gr.myLeads";
/** Сколько заявок помним: шапка опрашивает их все одним запросом. */
export const MY_LEADS_LIMIT = 20;

const isString = (x: unknown): x is string => typeof x === "string" && x !== "";

function isMyLead(x: unknown): x is MyLead {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const r = x as Record<string, unknown>;
  return (
    isString(r.id) &&
    isString(r.t) &&
    isString(r.url) &&
    (r.product === null || typeof r.product === "string") &&
    typeof r.createdAt === "number" &&
    Number.isFinite(r.createdAt)
  );
}

/** Записи по одной проверяем по форме: испорченные руками выбрасываем, остальные оставляем. */
export function parseMyLeads(x: unknown): MyLead[] {
  return Array.isArray(x) ? x.filter(isMyLead) : [];
}

/** Новая заявка — наверх; та же (по id) — заменяется; лишние старые — долой. */
export function upsertMyLead(list: readonly MyLead[], lead: MyLead): MyLead[] {
  return [lead, ...list.filter((l) => l.id !== lead.id)].slice(0, MY_LEADS_LIMIT);
}

/** Личная ссылка с токеном для показа и копирования: абсолютная, на текущем сайте. */
export function leadLink(origin: string, id: string, t: string): string {
  return `${origin.replace(/\/+$/, "")}/request/${encodeURIComponent(id)}?t=${encodeURIComponent(t)}`;
}

/** Мои заявки, новые сверху. Хранилище недоступно или испорчено — пустой список. */
export function getMyLeads(): MyLead[] {
  return parseMyLeads(readLocalJSON<unknown>(MY_LEADS_KEY, [])).sort((a, b) => b.createdAt - a.createdAt);
}

/** Запомнить отправленную заявку. */
export function rememberMyLead(lead: MyLead): void {
  writeLocalJSON(MY_LEADS_KEY, upsertMyLead(getMyLeads(), lead));
}

/** Токен заявки из «моих заявок» (страница открыта без ?t=). */
export function findMyLeadToken(id: string): string | null {
  return getMyLeads().find((l) => l.id === id)?.t ?? null;
}

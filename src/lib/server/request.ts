// Разбор входящих запросов API: тело — недоверенный ввод, типам не верим.

/** Тело запроса как объект; null — не JSON или не объект. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await request.json();
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Непустая строка без пробелов по краям или undefined. */
export function optionalString(x: unknown): string | undefined {
  if (typeof x !== "string") return undefined;
  const s = x.trim();
  return s || undefined;
}

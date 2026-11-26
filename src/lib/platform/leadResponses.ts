// Общие ответы маршрутов заявок /api/leads*.
import { NextResponse } from "next/server";
import type { LeadCreateErrors } from "@/lib/leads";
import { apiError, errorResponse } from "@/lib/server/errors";

/** Ошибка проверки полей: { error: { code: "INVALID_LEAD", message, fields } }. */
export function invalidLead(fields: LeadCreateErrors): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: "INVALID_LEAD",
        message: Object.values(fields)[0] ?? "Проверьте поля формы",
        fields,
      },
    },
    { status: 400 },
  );
}

/** Флаг leads выключен администрацией. */
export const leadsDisabled = () =>
  errorResponse(apiError("FEATURE_DISABLED", "Заявки временно не принимаются. Попробуйте позже"));

/** Заявки нет или токен чужой — один ответ на оба случая. */
export const leadNotFound = () => errorResponse(apiError("LEAD_NOT_FOUND"));

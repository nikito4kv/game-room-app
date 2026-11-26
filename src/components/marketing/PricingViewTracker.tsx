"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics/posthogClient";
import { LEAD_EVENTS } from "@/lib/leads";

/**
 * Событие «открыли страницу тарифов» (pricing_viewed): считаем интерес к платному.
 * Без свойств. Пока PostHog на проде выключен (нет ключей при сборке), событие
 * никуда не уходит, и это нормально: основной сигнал спроса — сами заявки.
 */
export function PricingViewTracker() {
  useEffect(() => {
    track(LEAD_EVENTS.pricingViewed);
  }, []);
  return null;
}

"use client";

import { Card } from "@/components/ui/Card";
import type { LeadProduct } from "@/lib/api/platform";
import { LeadForm } from "./LeadForm";

/** Что можно выбрать на странице клубов: по умолчанию — клуб (пилот). */
const CLUB_PRODUCTS: readonly LeadProduct[] = ["club", "event", "community", "other"];

/**
 * Заявка клуба на бесплатный пилот (30 дней). Форма стоит прямо на странице
 * /clubs; после отправки вместо неё — «Заявка отправлена» с личной ссылкой на
 * переписку. Платежей нет.
 */
export function PilotForm() {
  return (
    <Card padding="lg" radius="panel" className="sm:p-8">
      <LeadForm
        defaultProduct="club"
        products={CLUB_PRODUCTS}
        clubFieldsOpen
        messageLabel="Расскажите о клубе"
        messageHint="Чем пользуются гости сейчас, что хотите проверить. Ответим здесь же, на сайте."
        note="Бесплатно, без карты. Платить сейчас не нужно."
      />
    </Card>
  );
}

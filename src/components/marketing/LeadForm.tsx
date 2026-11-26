"use client";

import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { InlineAlert } from "@/components/ui/InlineAlert";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import { track } from "@/lib/analytics/posthogClient";
import { LEAD_PRODUCTS, type LeadCreateResponse, type LeadProduct } from "@/lib/api/platform";
import { createLead } from "@/lib/client/api";
import { isApiError } from "@/lib/client/errors";
import {
  LEAD_FIELD_ORDER,
  LEAD_FORM_LIMITS,
  checkLeadForm,
  leadSource,
  serverFieldErrors,
  showsClubFields,
  type LeadFormErrors,
  type LeadFormField,
  type LeadFormValues,
} from "@/lib/client/leadForm";
import { leadLink, rememberMyLead } from "@/lib/client/myLeads";
import { ConsentCheckbox } from "./ConsentCheckbox";
import { LeadSent, type SentLead } from "./LeadSent";
import { TextAreaField } from "./TextAreaField";

/** Событие аналитики «заявка отправлена»: только вид и продукт, без текста и контакта. */
const LEAD_SUBMITTED = "lead_submitted";

/**
 * Заявка-диалог (А5): имя или ник, что хочу, сообщение, необязательный контакт
 * и (для клуба) данные клуба. После отправки — экран «Заявка отправлена» с личной
 * ссылкой: ответ придёт туда, а не на почту. Ссылка и токен запоминаются в этом
 * браузере («мои заявки»), и шапка сайта покажет «Есть ответ на заявку».
 *
 * Одна форма на /pricing (в диалоге) и на /clubs (прямо на странице).
 */
export function LeadForm({
  defaultProduct,
  products,
  intro,
  messageLabel = "Сообщение",
  messageHint = "Что вам нужно, какой вопрос. Ответим здесь же, на сайте.",
  submitLabel = "Отправить заявку",
  note,
  clubFieldsOpen = false,
  onSent,
  sentAction,
}: {
  defaultProduct: LeadProduct;
  /** Какие варианты «что хочу» показать (по умолчанию — все). */
  products?: readonly LeadProduct[];
  /** Плашка над формой (что за тариф, что оплаты нет). */
  intro?: ReactNode;
  messageLabel?: string;
  messageHint?: string;
  submitLabel?: string;
  /** Строка рядом с кнопкой: «Бесплатно, без карты». */
  note?: ReactNode;
  /** Данные клуба раскрыты сразу (страница /clubs). */
  clubFieldsOpen?: boolean;
  onSent?: (lead: SentLead) => void;
  /** Кнопка на экране «Заявка отправлена» (в диалоге — «Закрыть»). */
  sentAction?: ReactNode;
}) {
  const formId = `lead-${useId().replace(/:/g, "")}`;
  const [values, setValues] = useState<LeadFormValues>({
    product: defaultProduct,
    name: "",
    message: "",
    contact: "",
    clubName: "",
    city: "",
    pcCount: "",
    consent: false,
  });
  const [errors, setErrors] = useState<LeadFormErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<SentLead | null>(null);
  const [clubOpen, setClubOpen] = useState(clubFieldsOpen);
  // Ловушка для ботов: человек это поле не видит и не заполняет.
  const [website, setWebsite] = useState("");
  const busy = useRef(false);
  const doneRef = useRef<HTMLDivElement>(null);

  const options = (products ?? (Object.keys(LEAD_PRODUCTS) as LeadProduct[])).map((p) => ({
    value: p,
    label: LEAD_PRODUCTS[p],
  }));
  const club = showsClubFields(values.product);

  function set<K extends keyof LeadFormValues>(key: K, value: LeadFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((prev) => {
      if (!prev[key as LeadFormField]) return prev;
      const next = { ...prev };
      delete next[key as LeadFormField];
      return next;
    });
  }

  function focusFirst(found: LeadFormErrors) {
    const field = LEAD_FIELD_ORDER.find((f) => found[f]);
    if (!field) return;
    if ((field === "clubName" || field === "city" || field === "pcCount") && !clubOpen) setClubOpen(true);
    requestAnimationFrame(() => document.getElementById(`${formId}-${field}`)?.focus());
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy.current) return;
    const check = checkLeadForm(values, leadSource(window.location.search));
    if (!check.ok) {
      setError(null);
      setErrors(check.errors);
      focusFirst(check.errors);
      return;
    }
    busy.current = true;
    setSending(true);
    setError(null);
    setErrors({});
    let res: LeadCreateResponse;
    try {
      res = await createLead({ ...check.request, ...(website ? { website } : {}) });
    } catch (err) {
      busy.current = false;
      setSending(false);
      if (isApiError(err) && err.fields) {
        const { errors: byField, rest } = serverFieldErrors(err.fields);
        setErrors(byField);
        setError(rest ?? (Object.keys(byField).length === 0 ? err.message : null));
        focusFirst(byField);
      } else {
        setError(isApiError(err) ? err.message : "Не получилось отправить. Попробуйте ещё раз");
      }
      return;
    }
    const link = leadLink(window.location.origin, res.id, res.token);
    rememberMyLead({ id: res.id, t: res.token, url: res.url || link, product: check.request.product, createdAt: Date.now() });
    track(LEAD_SUBMITTED, { kind: check.request.kind, product: check.request.product });
    const lead: SentLead = { id: res.id, token: res.token, link, contact: check.request.contact ?? null };
    busy.current = false;
    setSending(false);
    setSent(lead);
    onSent?.(lead);
    // Форма исчезла вместе с кнопкой, на которой был фокус: ставим его на итог.
    requestAnimationFrame(() => doneRef.current?.focus());
  }

  if (sent) return <LeadSent ref={doneRef} lead={sent} action={sentAction} />;

  return (
    <form id={formId} onSubmit={onSubmit} noValidate className="flex flex-col gap-5" data-testid="lead-form">
      {intro}

      {error && (
        <InlineAlert tone="alert" title="Не получилось отправить">
          {error}
        </InlineAlert>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id={`${formId}-name`}
          label="Как к вам обращаться"
          hint="Имя или ник"
          error={errors.name}
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          maxLength={LEAD_FORM_LIMITS.nameMax + 10}
          autoComplete="nickname"
        />
        {options.length > 1 && (
          <Select
            id={`${formId}-product`}
            label="Что вас интересует"
            error={errors.product}
            value={values.product}
            onChange={(e) => set("product", e.target.value as LeadProduct)}
            options={options}
          />
        )}
      </div>

      <TextAreaField
        id={`${formId}-message`}
        label={messageLabel}
        hint={messageHint}
        error={errors.message}
        value={values.message}
        onChange={(e) => set("message", e.target.value)}
        maxLength={LEAD_FORM_LIMITS.messageMax}
        rows={4}
      />

      <TextField
        id={`${formId}-contact`}
        label="Куда ещё написать"
        hint="Необязательно. Почта, VK или Telegram — если хотите, чтобы написали туда. Иначе ответ придёт на этой странице."
        error={errors.contact}
        value={values.contact}
        onChange={(e) => set("contact", e.target.value)}
        maxLength={LEAD_FORM_LIMITS.contactMax + 20}
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="name@mail.ru или @nick"
      />

      {club &&
        (clubOpen ? (
          <fieldset className="flex flex-col gap-3 rounded-card border border-line p-4">
            <legend className="px-1 text-label font-medium text-ink-2">Данные клуба · необязательно</legend>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem]">
              <TextField
                id={`${formId}-clubName`}
                label="Название"
                error={errors.clubName}
                value={values.clubName}
                onChange={(e) => set("clubName", e.target.value)}
                maxLength={LEAD_FORM_LIMITS.clubNameMax + 10}
                autoComplete="organization"
              />
              <TextField
                id={`${formId}-city`}
                label="Город"
                error={errors.city}
                value={values.city}
                onChange={(e) => set("city", e.target.value)}
                maxLength={LEAD_FORM_LIMITS.cityMax + 10}
                autoComplete="address-level2"
              />
              <TextField
                id={`${formId}-pcCount`}
                label="Сколько ПК"
                error={errors.pcCount}
                value={values.pcCount}
                onChange={(e) => set("pcCount", e.target.value)}
                inputMode="numeric"
                maxLength={5}
                autoComplete="off"
              />
            </div>
          </fieldset>
        ) : (
          <Button variant="ghost" size="sm" icon="plus" className="self-start" onClick={() => setClubOpen(true)}>
            Добавить данные клуба
          </Button>
        ))}

      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Сайт
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </label>
      </div>

      <ConsentCheckbox
        id={`${formId}-consent`}
        checked={values.consent}
        onChange={(v) => set("consent", v)}
        purpose="чтобы мне ответили на заявку"
        error={errors.consent}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button type="submit" variant="primary" size="lg" loading={sending} className="max-sm:w-full">
          {submitLabel}
        </Button>
        {note && <p className="text-label text-ink-3">{note}</p>}
      </div>
    </form>
  );
}

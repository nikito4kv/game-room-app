import { describe, expect, it } from "vitest";
import {
  LEAD_FORM_LIMITS,
  checkLeadForm,
  kindForProduct,
  leadSource,
  serverFieldErrors,
  showsClubFields,
  type LeadFormValues,
} from "./leadForm";

const base: LeadFormValues = {
  product: "pro",
  name: "  Тёма ",
  message: " Хочу постоянную комнату ",
  contact: "",
  clubName: "Арена",
  city: "Казань",
  pcCount: "20",
  consent: true,
};

describe("checkLeadForm", () => {
  it("собирает тело: без пустого контакта и без полей клуба у не-клуба", () => {
    const r = checkLeadForm(base);
    expect(r).toEqual({
      ok: true,
      request: { kind: "pricing", product: "pro", name: "Тёма", message: "Хочу постоянную комнату", consent: true },
    });
  });

  it("клуб: данные клуба и число ПК числом, контакт и источник — если есть", () => {
    const r = checkLeadForm({ ...base, product: "club", contact: " @arena " }, "vk / post");
    expect(r.ok && r.request).toEqual({
      kind: "club",
      product: "club",
      name: "Тёма",
      message: "Хочу постоянную комнату",
      contact: "@arena",
      clubName: "Арена",
      city: "Казань",
      pcCount: 20,
      consent: true,
      source: "vk / post",
    });
  });

  it("ошибки: имя, сообщение, согласие, число ПК, длина", () => {
    const r = checkLeadForm({
      ...base,
      product: "club",
      name: " ",
      message: "",
      pcCount: "0",
      consent: false,
      contact: "x".repeat(LEAD_FORM_LIMITS.contactMax + 1),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(["consent", "contact", "message", "name", "pcCount"]);
  });

  it("длину считает по символам, а не по UTF-16", () => {
    const emoji = "😀".repeat(LEAD_FORM_LIMITS.nameMax);
    expect(checkLeadForm({ ...base, name: emoji }).ok).toBe(true);
  });
});

describe("вспомогательное", () => {
  it("вид заявки по продукту", () => {
    expect(kindForProduct("club")).toBe("club");
    expect(kindForProduct("event")).toBe("event");
    expect(kindForProduct("other")).toBe("other");
    expect(kindForProduct("gift")).toBe("pricing");
    expect(showsClubFields("club")).toBe(true);
    expect(showsClubFields("pro")).toBe(false);
  });

  it("ошибки сервера: известные поля — к полям, прочее — общим текстом", () => {
    expect(serverFieldErrors({ name: "Нужно имя", website: "бот" })).toEqual({
      errors: { name: "Нужно имя" },
      rest: "бот",
    });
    expect(serverFieldErrors(undefined)).toEqual({ errors: {}, rest: null });
  });

  it("источник из utm-меток", () => {
    expect(leadSource("?utm_source=vk&utm_campaign=clubs")).toBe("vk / clubs");
    expect(leadSource("?t=1")).toBeUndefined();
  });
});

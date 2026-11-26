import { describe, expect, it } from "vitest";
import { cleanLine, cleanNote, contactTypeOf, LEAD_LIMITS, validateLead } from "./leads";

const waitlist = {
  kind: "waitlist",
  tier: "pro",
  contact: "name@mail.ru",
  role: "friends",
  consent: true,
};

const pilot = {
  kind: "club_pilot",
  contact: "@owner_club",
  clubName: "Колизей",
  city: "Казань",
  pcCount: "24",
  consent: true,
};

function errorsOf(input: unknown) {
  const r = validateLead(input);
  if (r.ok) throw new Error("ожидали отказ");
  return r.errors;
}

describe("validateLead: лист ожидания", () => {
  it("принимает минимальную заявку", () => {
    const r = validateLead(waitlist);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lead).toMatchObject({
        kind: "waitlist",
        tier: "pro",
        contact: "name@mail.ru",
        contactType: "email",
        role: "friends",
        clubName: null,
        city: null,
        pcCount: null,
        note: null,
        consent: true,
      });
    }
  });

  it("без согласия отказывает", () => {
    expect(errorsOf({ ...waitlist, consent: false }).consent).toBeTruthy();
    expect(errorsOf({ ...waitlist, consent: "true" }).consent).toBeTruthy();
    const noConsent: Record<string, unknown> = { ...waitlist };
    delete noConsent.consent;
    expect(errorsOf(noConsent).consent).toBeTruthy();
  });

  it("требует тариф и роль", () => {
    expect(errorsOf({ ...waitlist, tier: "max" }).tier).toBeTruthy();
    expect(errorsOf({ ...waitlist, tier: undefined }).tier).toBeTruthy();
    expect(errorsOf({ ...waitlist, role: "boss" }).role).toBeTruthy();
    expect(errorsOf({ ...waitlist, role: undefined }).role).toBeTruthy();
  });

  it("берёт тариф «поддержать»", () => {
    const r = validateLead({ ...waitlist, tier: "support" });
    expect(r.ok && r.lead.tier).toBe("support");
  });

  it("клуб в листе ожидания: название и город необязательны", () => {
    const r = validateLead({ ...waitlist, tier: "club", role: "club", clubName: "  Арена  ", city: "" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lead.clubName).toBe("Арена");
      expect(r.lead.city).toBeNull();
    }
  });

  it("заметка: до 300 символов, абзацы сохраняются", () => {
    const ok = validateLead({ ...waitlist, note: "Первая строка\r\n\r\n\r\n\r\nВторая" });
    expect(ok.ok && ok.lead.note).toBe("Первая строка\n\nВторая");
    expect(validateLead({ ...waitlist, note: "я".repeat(LEAD_LIMITS.noteMax) }).ok).toBe(true);
    expect(errorsOf({ ...waitlist, note: "я".repeat(LEAD_LIMITS.noteMax + 1) }).note).toBeTruthy();
  });

  it("длину считает в символах, а не в кодовых единицах: эмодзи по одному", () => {
    expect(validateLead({ ...waitlist, note: "😀".repeat(LEAD_LIMITS.noteMax) }).ok).toBe(true);
  });
});

describe("validateLead: контакт", () => {
  it("узнаёт e-mail, @ник, VK и Telegram", () => {
    expect(contactTypeOf("name@mail.ru")).toBe("email");
    expect(contactTypeOf("@nick_name")).toBe("handle");
    expect(contactTypeOf("t.me/nick")).toBe("telegram");
    expect(contactTypeOf("тг: nick")).toBe("telegram");
    expect(contactTypeOf("vk.com/id123")).toBe("vk");
    expect(contactTypeOf("вк Тёма")).toBe("vk");
    expect(contactTypeOf("просто Тёма")).toBe("other");
  });

  it("не принимает пустое, короткое и слишком длинное", () => {
    expect(errorsOf({ ...waitlist, contact: "" }).contact).toBeTruthy();
    expect(errorsOf({ ...waitlist, contact: "   " }).contact).toBeTruthy();
    expect(errorsOf({ ...waitlist, contact: "ab" }).contact).toBeTruthy();
    expect(errorsOf({ ...waitlist, contact: "a".repeat(LEAD_LIMITS.contactMax + 1) }).contact).toBeTruthy();
    expect(errorsOf({ ...waitlist, contact: 12345 }).contact).toBeTruthy();
  });

  it("отказывает телефонам: они не нужны", () => {
    for (const phone of ["+7 (999) 123-45-67", "89991234567", "8 999 123 45 67"]) {
      expect(errorsOf({ ...waitlist, contact: phone }).contact).toMatch(/Телефон не нужен/);
    }
  });

  it("ловит опечатку в e-mail, но не мешает нику с @", () => {
    expect(errorsOf({ ...waitlist, contact: "name@mail" }).contact).toMatch(/e-mail/);
    expect(errorsOf({ ...waitlist, contact: "name@" }).contact).toMatch(/e-mail/);
    expect(validateLead({ ...waitlist, contact: "@nick" }).ok).toBe(true);
  });

  it("не пускает угловые скобки (разметку)", () => {
    expect(errorsOf({ ...waitlist, contact: "<script>alert(1)</script>" }).contact).toBeTruthy();
  });

  it("чистит пробелы и управляющие символы", () => {
    const r = validateLead({ ...waitlist, contact: "  name@mail.ru​ \n" });
    expect(r.ok && r.lead.contact).toBe("name@mail.ru");
  });
});

describe("validateLead: заявка клуба на пилот", () => {
  it("принимает полную заявку; роль и тариф ставит сама", () => {
    const r = validateLead(pilot);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lead).toMatchObject({
        kind: "club_pilot",
        tier: "club",
        role: "club",
        clubName: "Колизей",
        city: "Казань",
        pcCount: 24,
        contactType: "handle",
      });
    }
  });

  it("требует название, город и число ПК", () => {
    expect(errorsOf({ ...pilot, clubName: "" }).clubName).toBeTruthy();
    expect(errorsOf({ ...pilot, city: " " }).city).toBeTruthy();
    expect(errorsOf({ ...pilot, pcCount: "" }).pcCount).toBeTruthy();
    expect(errorsOf({ ...pilot, pcCount: undefined }).pcCount).toBeTruthy();
  });

  it("число ПК — целое от 1 до 1000", () => {
    for (const bad of ["0", "-3", "12,5", "abc", "1001", "99999999", 0, 2.5]) {
      expect(errorsOf({ ...pilot, pcCount: bad }).pcCount).toBeTruthy();
    }
    expect(validateLead({ ...pilot, pcCount: 1 }).ok).toBe(true);
    expect(validateLead({ ...pilot, pcCount: "1000" }).ok).toBe(true);
  });

  it("поле note («чем пользуются гости») необязательно", () => {
    const r = validateLead({ ...pilot, note: "Discord и TeamSpeak" });
    expect(r.ok && r.lead.note).toBe("Discord и TeamSpeak");
  });
});

describe("validateLead: мусор на входе", () => {
  it("не объект — отказ без падения", () => {
    for (const bad of [null, undefined, "строка", 42, [], true]) {
      expect(errorsOf(bad).form).toBeTruthy();
    }
  });

  it("неизвестный тип заявки", () => {
    expect(errorsOf({ ...waitlist, kind: "spam" }).kind).toBeTruthy();
  });

  it("неизвестные поля игнорирует и в результат не пускает", () => {
    const r = validateLead({ ...waitlist, ip: "1.2.3.4", __proto__: { x: 1 }, extra: "да" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.lead).sort()).not.toContain("extra");
  });
});

describe("очистка текста", () => {
  it("cleanLine схлопывает пробелы и убирает невидимое", () => {
    expect(cleanLine("  а \t б\n\nв‮ ")).toBe("а б в");
    expect(cleanLine(null)).toBe("");
  });

  it("cleanNote оставляет абзацы, но не больше одной пустой строки", () => {
    expect(cleanNote("а\n\n\n\nб")).toBe("а\n\nб");
    expect(cleanNote("  а  \n  б  ")).toBe("а\nб");
  });
});

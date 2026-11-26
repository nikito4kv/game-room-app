import { describe, expect, it } from "vitest";
import { formatLeadTime, leadStatusText, tokenFromSearch } from "./leadThread";

describe("страница заявки", () => {
  it("статус: известный и запасной", () => {
    expect(leadStatusText("answered").label).toBe("Есть ответ");
    expect(leadStatusText("weird").label).toBe("Отправлена");
  });

  it("время: сегодня, вчера, дата, другой год", () => {
    const now = new Date(2026, 9, 6, 12, 0);
    expect(formatLeadTime(new Date(2026, 9, 6, 9, 5).toISOString(), now)).toBe("09:05");
    expect(formatLeadTime(new Date(2026, 9, 5, 21, 7).toISOString(), now)).toBe("вчера, 21:07");
    expect(formatLeadTime(new Date(2026, 9, 1, 8, 0).toISOString(), now)).toBe("1 октября, 08:00");
    expect(formatLeadTime(new Date(2025, 11, 31, 23, 59).toISOString(), now)).toBe("31 декабря 2025, 23:59");
    expect(formatLeadTime("nope", now)).toBe("");
  });

  it("токен из адреса", () => {
    expect(tokenFromSearch("?t=abc")).toBe("abc");
    expect(tokenFromSearch("?t=")).toBeNull();
    expect(tokenFromSearch("")).toBeNull();
  });
});

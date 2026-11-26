import { describe, expect, it } from "vitest";
import { MY_LEADS_LIMIT, leadLink, parseMyLeads, upsertMyLead, type MyLead } from "./myLeads";

const lead = (id: string, createdAt = 1): MyLead => ({
  id,
  t: `tok-${id}`,
  url: `/request/${id}?t=tok-${id}`,
  product: "pro",
  createdAt,
});

describe("myLeads", () => {
  it("новая заявка — наверх, та же по id заменяется", () => {
    const next = upsertMyLead([lead("a", 1), lead("b", 2)], { ...lead("b", 5), t: "new" });
    expect(next.map((l) => l.id)).toEqual(["b", "a"]);
    expect(next[0].t).toBe("new");
  });

  it(`помнит не больше ${MY_LEADS_LIMIT}`, () => {
    const many = Array.from({ length: MY_LEADS_LIMIT }, (_, i) => lead(`x${i}`, i));
    expect(upsertMyLead(many, lead("new"))).toHaveLength(MY_LEADS_LIMIT);
  });

  it("испорченные записи выбрасывает по одной, правильные оставляет", () => {
    const raw = [lead("ok"), { id: "bad" }, null, "str", { ...lead("p"), product: null }];
    expect(parseMyLeads(raw).map((l) => l.id)).toEqual(["ok", "p"]);
    expect(parseMyLeads({ not: "array" })).toEqual([]);
  });

  it("личная ссылка — абсолютная и с экранированием", () => {
    expect(leadLink("https://game-room.space/", "ab c", "t/1")).toBe("https://game-room.space/request/ab%20c?t=t%2F1");
  });
});

import { describe, expect, it } from "vitest";
import { byAppearance, pickFocus, trackAppearance } from "./screens";

describe("trackAppearance", () => {
  it("новые показы получают следующие номера, пропавшие забываются", () => {
    const a = trackAppearance(new Map(), ["s1", "s2"], 0);
    expect([...a.order]).toEqual([
      ["s1", 0],
      ["s2", 1],
    ]);
    // s3 начался позже — даже если LiveKit поставил его первым в списке.
    const b = trackAppearance(a.order, ["s3", "s1", "s2"], a.nextSeq);
    expect(b.order.get("s3")).toBe(2);
    expect(b.order.get("s1")).toBe(0);
    const c = trackAppearance(b.order, ["s3"], b.nextSeq);
    expect([...c.order]).toEqual([["s3", 2]]);
  });

  it("без перемен — тот же объект", () => {
    const a = trackAppearance(new Map(), ["s1"], 0);
    expect(trackAppearance(a.order, ["s1"], a.nextSeq).order).toBe(a.order);
  });
});

describe("byAppearance", () => {
  it("по времени появления, а не по порядку участников", () => {
    const order = new Map([
      ["late", 5],
      ["early", 1],
    ]);
    const items = [{ sid: "late" }, { sid: "early" }];
    expect(byAppearance(items, (i) => i.sid, order).map((i) => i.sid)).toEqual(["early", "late"]);
  });
});

describe("pickFocus", () => {
  it("по умолчанию — самый новый показ", () => {
    expect(pickFocus(["a", "b"], null)).toBe("b");
  });

  it("ручной выбор держится, пока показ виден", () => {
    expect(pickFocus(["a", "b"], "a")).toBe("a");
    expect(pickFocus(["b"], "a")).toBe("b");
  });

  it("видимых нет — сцены нет", () => {
    expect(pickFocus([], "a")).toBeNull();
  });
});

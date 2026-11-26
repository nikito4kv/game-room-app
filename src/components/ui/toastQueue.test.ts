import { describe, expect, it } from "vitest";
import { markLeaving, promoteToast, removeToast, upsertToast, visibleToasts } from "./toastQueue";

type T = { id: string; text: string; leaving?: boolean };

describe("upsertToast", () => {
  it("добавляет в конец", () => {
    const list = upsertToast<T>([{ id: "a", text: "1" }], { id: "b", text: "2" });
    expect(list.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("тот же id обновляет на месте", () => {
    const list = upsertToast<T>(
      [
        { id: "a", text: "Переподключаемся…" },
        { id: "b", text: "x" },
      ],
      { id: "a", text: "Снова на связи" },
    );
    expect(list).toEqual([
      { id: "a", text: "Снова на связи" },
      { id: "b", text: "x" },
    ]);
  });

  it("держит не больше max, выкидывая самые старые", () => {
    let list: T[] = [];
    for (let i = 0; i < 5; i++) list = upsertToast(list, { id: `t${i}`, text: "" }, 3);
    expect(list.map((t) => t.id)).toEqual(["t2", "t3", "t4"]);
  });
});

describe("markLeaving / removeToast", () => {
  it("помечает и удаляет", () => {
    const list: T[] = [
      { id: "a", text: "" },
      { id: "b", text: "" },
    ];
    expect(markLeaving(list, "a")[0].leaving).toBe(true);
    expect(removeToast(list, "a").map((t) => t.id)).toEqual(["b"]);
  });
});

describe("visibleToasts", () => {
  it("показывает первые N и уходящие сверх лимита", () => {
    const list: T[] = [
      { id: "a", text: "", leaving: true },
      { id: "b", text: "" },
      { id: "c", text: "" },
      { id: "d", text: "" },
      { id: "e", text: "" },
    ];
    expect(visibleToasts(list, 3).map((t) => t.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("promoteToast", () => {
  const ids = (list: { id: string }[]) => list.map((t) => t.id);

  it("ответ на нажатие встаёт в видимые сразу, самый старый уходит", () => {
    const list: T[] = ["a", "b", "c", "d", "r"].map((id) => ({ id, text: "" }));
    const { list: next, evict } = promoteToast(list, "r", 3);
    expect(evict).toBe("a");
    // Встал сразу за видимыми, перед ждущим «d».
    expect(ids(next)).toEqual(["a", "b", "c", "r", "d"]);
    expect(ids(visibleToasts(markLeaving(next, "a"), 3))).toEqual(["a", "b", "c", "r"]);
  });

  it("свободное место — никого не вытесняет", () => {
    const list: T[] = ["a", "r"].map((id) => ({ id, text: "" }));
    expect(promoteToast(list, "r", 3)).toEqual({ list, evict: null });
  });

  it("уже видимый остаётся на месте", () => {
    const list: T[] = ["a", "r", "b", "c"].map((id) => ({ id, text: "" }));
    expect(promoteToast(list, "r", 3)).toEqual({ list, evict: null });
  });

  it("уходящие места не занимают", () => {
    const list: T[] = [
      { id: "a", text: "", leaving: true },
      { id: "b", text: "" },
      { id: "c", text: "" },
      { id: "r", text: "" },
    ];
    expect(promoteToast(list, "r", 3).evict).toBeNull();
  });
});

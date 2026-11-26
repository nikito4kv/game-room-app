import { describe, expect, it } from "vitest";
import { panelSide, tableSeatSize, toastTop, zoneLayout, type ToastAnchors } from "./zoneLayout";

describe("zoneLayout", () => {
  it("узкое окно — список", () => {
    expect(zoneLayout(390, 800)).toBe("list");
    expect(zoneLayout(559, 1200)).toBe("list");
  });

  it("низкое широкое окно — ряд", () => {
    expect(zoneLayout(1280, 504)).toBe("row");
  });

  it("обычное окно — стол", () => {
    expect(zoneLayout(1440, 844)).toBe("table");
    expect(zoneLayout(1024, 712)).toBe("table");
  });
});

describe("tableSeatSize", () => {
  it("до шести — крупные места, больше — средние", () => {
    expect(tableSeatSize(1)).toBe("lg");
    expect(tableSeatSize(6)).toBe("lg");
    expect(tableSeatSize(7)).toBe("md");
    expect(tableSeatSize(10)).toBe("md");
  });
});

describe("toastTop", () => {
  const wide: ToastAnchors = { zoneTop: 56, bannersBottom: null, stageTop: null, list: null, dockTop: 820 };

  it("стол без плашек — под шапкой, как в макете (68)", () => {
    expect(toastTop(wide)).toBe(68);
  });

  it("плашки над столом не закрываем — тосты ниже них", () => {
    expect(toastTop({ ...wide, bannersBottom: 150.4 })).toBe(158);
  });

  it("сцена — под её плашкой «Эфир», с плашками — ниже обеих", () => {
    expect(toastTop({ ...wide, stageTop: 72 })).toBe(120);
    expect(toastTop({ ...wide, bannersBottom: 150, stageTop: 162 })).toBe(210);
  });

  it("список с чатом — на стыке со чатом, под последней строкой", () => {
    const list = { contentBottom: 270, zoneBottom: 380 };
    expect(toastTop({ ...wide, list, dockTop: 783 })).toBe(278);
  });

  it("длинный список — над доком, а не за краем экрана", () => {
    const list = { contentBottom: 900, zoneBottom: 720 };
    expect(toastTop({ ...wide, list, dockTop: 783 })).toBe(695);
  });

  it("совсем низкое окно — всё равно не выше шапки и плашек", () => {
    const list = { contentBottom: 150, zoneBottom: 150 };
    expect(toastTop({ ...wide, list, dockTop: 120 })).toBe(64);
  });
});

describe("panelSide", () => {
  it("наружу от центра зоны, у оси — снизу", () => {
    expect(panelSide(900, 600)).toBe("right");
    expect(panelSide(300, 600)).toBe("left");
    expect(panelSide(620, 600)).toBe("bottom");
  });
});

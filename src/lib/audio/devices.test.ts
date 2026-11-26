import { describe, expect, it } from "vitest";
import {
  defaultDeviceSignature,
  deviceLabel,
  deviceOptions,
  findDefaultDevice,
  isDeviceAvailable,
  micDeviceConstraint,
  resolveOutputSinkId,
  type DeviceInfo,
} from "./devices";

const d = (kind: MediaDeviceKind, deviceId: string, groupId: string, label: string): DeviceInfo => ({
  kind,
  deviceId,
  groupId,
  label,
});

// Как отдаёт Chrome на Windows: служебные «default» и «communications» + настоящие.
const chrome: DeviceInfo[] = [
  d("audioinput", "default", "g-hx", "Default - Микрофон (HyperX Cloud II)"),
  d("audioinput", "communications", "g-cam", "Communications - Микрофон (Веб-камера)"),
  d("audioinput", "mic-hx", "g-hx", "Микрофон (HyperX Cloud II)"),
  d("audioinput", "mic-cam", "g-cam", "Микрофон (Веб-камера)"),
  d("audiooutput", "default", "g-hx", "По умолчанию - Наушники (HyperX Cloud II)"),
  d("audiooutput", "communications", "g-hx", "Связь - Наушники (HyperX Cloud II)"),
  d("audiooutput", "out-hx", "g-hx", "Наушники (HyperX Cloud II)"),
  d("audiooutput", "out-spk", "g-spk", "Динамики (Realtek)"),
];

describe("устройство по умолчанию", () => {
  it("Chrome — запись «default», Firefox — первое в списке", () => {
    expect(findDefaultDevice(chrome, "audioinput")?.deviceId).toBe("default");
    const firefox = [d("audioinput", "a", "g1", "Mic A"), d("audioinput", "b", "g2", "Mic B")];
    expect(findDefaultDevice(firefox, "audioinput")?.deviceId).toBe("a");
    expect(findDefaultDevice([], "audioinput")).toBeUndefined();
  });
  it("подпись меняется, когда Windows сменила устройство по умолчанию", () => {
    const before = defaultDeviceSignature(chrome, "audioinput");
    const after = chrome.map((x) =>
      x.kind === "audioinput" && x.deviceId === "default"
        ? { ...x, groupId: "g-cam", label: "Default - Микрофон (Веб-камера)" }
        : x,
    );
    expect(defaultDeviceSignature(after, "audioinput")).not.toBe(before);
    expect(defaultDeviceSignature(chrome, "audioinput")).toBe(before);
  });
});

describe("isDeviceAvailable", () => {
  it("выбранный микрофон есть или пропал", () => {
    expect(isDeviceAvailable("mic-hx", chrome, "audioinput")).toBe(true);
    expect(isDeviceAvailable("mic-usb", chrome, "audioinput")).toBe(false);
    // Устройство вывода с тем же id — не микрофон.
    expect(isDeviceAvailable("out-hx", chrome, "audioinput")).toBe(false);
  });
  it("«как в системе» есть, пока есть хоть одно устройство", () => {
    expect(isDeviceAvailable("default", chrome, "audioinput")).toBe(true);
    expect(isDeviceAvailable("default", [], "audioinput")).toBe(false);
  });
});

describe("micDeviceConstraint", () => {
  // Chrome при мягком или пустом deviceId берёт свой «любимый» микрофон (у автора —
  // веб-камеру V380), поэтому просим только точно.
  it("выбранный микрофон из списка — точно", () => {
    expect(micDeviceConstraint("mic-hx", chrome)).toEqual({ exact: "mic-hx" });
  });
  it("«Как в системе» в Chrome — точно запись default (устройство Windows по умолчанию)", () => {
    expect(micDeviceConstraint("default", chrome)).toEqual({ exact: "default" });
    expect(micDeviceConstraint(null, chrome)).toEqual({ exact: "default" });
    expect(micDeviceConstraint(undefined, chrome)).toEqual({ exact: "default" });
  });
  it("Firefox и Safari: записи default нет — «Как в системе» без ограничения, выбранный — точно", () => {
    const firefox = [d("audioinput", "a", "g1", "Mic A"), d("audioinput", "b", "g2", "Mic B")];
    expect(micDeviceConstraint("default", firefox)).toBeUndefined();
    expect(micDeviceConstraint("b", firefox)).toEqual({ exact: "b" });
  });
  it("выбранного нет в списке (выдернули) — как «Как в системе»; strict — всё равно точно он", () => {
    expect(micDeviceConstraint("mic-usb", chrome)).toEqual({ exact: "default" });
    expect(micDeviceConstraint("mic-usb", chrome, true)).toEqual({ exact: "mic-usb" });
    // Устройство вывода с тем же id — не микрофон.
    expect(micDeviceConstraint("out-hx", chrome)).toEqual({ exact: "default" });
  });
  it("список неизвестен (нет разрешения — пустые id): выбранный точно, «Как в системе» без ограничения", () => {
    const hidden = [d("audioinput", "", "", "")];
    expect(micDeviceConstraint("mic-hx", hidden)).toEqual({ exact: "mic-hx" });
    expect(micDeviceConstraint("default", hidden)).toBeUndefined();
    expect(micDeviceConstraint("mic-hx", [])).toEqual({ exact: "mic-hx" });
    expect(micDeviceConstraint("default", [])).toBeUndefined();
  });
});

describe("resolveOutputSinkId", () => {
  it("«как в системе» → настоящее устройство за записью default (по groupId), не communications", () => {
    expect(resolveOutputSinkId("default", chrome)).toBe("out-hx");
  });
  it("конкретное устройство — как есть; не нашли за default — пустая строка (системный вывод)", () => {
    expect(resolveOutputSinkId("out-spk", chrome)).toBe("out-spk");
    expect(resolveOutputSinkId("default", [d("audiooutput", "default", "g-x", "x")])).toBe("");
    expect(resolveOutputSinkId("default", [])).toBe("");
  });
});

describe("подписи", () => {
  it("убирает приставки «Default -» и «По умолчанию -»", () => {
    expect(deviceLabel(chrome[0], "?")).toBe("Микрофон (HyperX Cloud II)");
    expect(deviceLabel(chrome[4], "?")).toBe("Наушники (HyperX Cloud II)");
    expect(deviceLabel(d("audioinput", "x", "g", ""), "Микрофон")).toBe("Микрофон");
    expect(deviceLabel(undefined, "нет")).toBe("нет");
  });
  it("список: «Как в системе (имя)» и настоящие устройства без служебных", () => {
    expect(deviceOptions(chrome, "audioinput", "Микрофон")).toEqual([
      { value: "default", label: "Как в системе (Микрофон (HyperX Cloud II))" },
      { value: "mic-hx", label: "Микрофон (HyperX Cloud II)" },
      { value: "mic-cam", label: "Микрофон (Веб-камера)" },
    ]);
  });
  it("без разрешения (пустые названия и id) — один пункт «Как в системе»", () => {
    const hidden = [d("audioinput", "", "", "")];
    expect(deviceOptions(hidden, "audioinput", "Микрофон")).toEqual([{ value: "default", label: "Как в системе" }]);
  });
  it("безымянные устройства нумеруются", () => {
    const list = [d("audiooutput", "a", "g1", ""), d("audiooutput", "b", "g2", "")];
    expect(deviceOptions(list, "audiooutput", "Устройство вывода").map((o) => o.label)).toEqual([
      "Как в системе",
      "Устройство вывода 1",
      "Устройство вывода 2",
    ]);
  });
});

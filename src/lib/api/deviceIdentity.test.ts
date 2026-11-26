import { describe, expect, it } from "vitest";
import { createDeviceIdentity, identityForDevice, parseDeviceIdentity } from "./deviceIdentity";

describe("createDeviceIdentity", () => {
  it("id — 22 символа base64url, secret — 43", () => {
    const d = createDeviceIdentity();
    expect(d.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(d.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("каждый раз новые", () => {
    const a = createDeviceIdentity();
    const b = createDeviceIdentity();
    expect(a.id).not.toBe(b.id);
    expect(a.secret).not.toBe(b.secret);
  });

  it("base64url без +, / и =", () => {
    const d = createDeviceIdentity((n) => new Uint8Array(n).fill(0xff));
    expect(d.id).toBe("_".repeat(21) + "w");
    expect(d.secret).not.toMatch(/[+/=]/);
  });
});

describe("parseDeviceIdentity", () => {
  it("принимает созданное и отвергает мусор", () => {
    const d = createDeviceIdentity();
    expect(parseDeviceIdentity(d)).toEqual(d);
    expect(parseDeviceIdentity(JSON.parse(JSON.stringify(d)))).toEqual(d);
    expect(parseDeviceIdentity(null)).toBeNull();
    expect(parseDeviceIdentity("x")).toBeNull();
    expect(parseDeviceIdentity({ id: d.id })).toBeNull();
    expect(parseDeviceIdentity({ id: "коротко", secret: d.secret })).toBeNull();
    expect(parseDeviceIdentity({ id: d.id, secret: "s".repeat(31) })).toBeNull();
    expect(parseDeviceIdentity({ id: d.id + "!", secret: d.secret })).toBeNull();
  });
});

describe("identity", () => {
  it('identity = "u_" + id', () => {
    expect(identityForDevice("abc")).toBe("u_abc");
  });
});

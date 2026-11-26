import { describe, expect, it } from "vitest";
import { decideAdmission, takesHostOnJoin, type AdmissionInput } from "./joinRules";

const base: AdmissionInput = {
  identity: "u_me",
  name: "Аня",
  owner: false,
  seat: "ok",
  banned: false,
  kickRemainingSec: 0,
  locked: false,
  member: false,
  isHost: false,
  participants: [],
  maxParticipants: 10,
};

describe("decideAdmission", () => {
  it("обычный вход — пускаем", () => {
    expect(decideAdmission(base)).toBeNull();
  });

  it("место закреплено за другим устройством — SEAT_TAKEN (даже владельцу)", () => {
    expect(decideAdmission({ ...base, seat: "foreign" })?.code).toBe("SEAT_TAKEN");
    expect(decideAdmission({ ...base, seat: "foreign", owner: true })?.code).toBe("SEAT_TAKEN");
  });

  it("бан, кик с остатком и замок", () => {
    expect(decideAdmission({ ...base, banned: true })?.code).toBe("BANNED");
    const kicked = decideAdmission({ ...base, kickRemainingSec: 240 });
    expect(kicked).toMatchObject({ code: "KICKED", retryAfterSec: 240 });
    expect(decideAdmission({ ...base, locked: true })?.code).toBe("ROOM_LOCKED");
  });

  it("в запертую пускаем «своих» и хоста", () => {
    expect(decideAdmission({ ...base, locked: true, member: true })).toBeNull();
    expect(decideAdmission({ ...base, locked: true, isHost: true })).toBeNull();
  });

  it("владелец проходит мимо бана, кика и замка", () => {
    expect(decideAdmission({ ...base, owner: true, banned: true, kickRemainingSec: 100, locked: true })).toBeNull();
  });

  it("заполненная комната; свой же identity в комнате место не занимает", () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ identity: `u_${i}`, name: `Игрок ${i}` }));
    expect(decideAdmission({ ...base, participants: ten })?.code).toBe("ROOM_FULL");
    const withMe = [...ten.slice(0, 9), { identity: "u_me", name: "Аня" }];
    expect(decideAdmission({ ...base, participants: withMe })).toBeNull();
  });

  it("ник занят другим присутствующим — NAME_TAKEN с подсказкой", () => {
    const err = decideAdmission({ ...base, participants: [{ identity: "u_x", name: "АНЯ" }] });
    expect(err).toMatchObject({ code: "NAME_TAKEN", suggestion: "Аня 2" });
  });

  it("свой же identity с тем же ником (обрыв, вторая вкладка) — пускаем", () => {
    expect(decideAdmission({ ...base, participants: [{ identity: "u_me", name: "Аня" }] })).toBeNull();
  });

  it("пароль/место/бан проверяются раньше заполненности и ника", () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ identity: `u_${i}`, name: "Аня" }));
    expect(decideAdmission({ ...base, banned: true, participants: ten })?.code).toBe("BANNED");
  });
});

describe("takesHostOnJoin", () => {
  it("владелец занимает свободное место; не владелец — нет", () => {
    expect(takesHostOnJoin({ owner: true, identity: "u_o", hostIdentity: null, hostPresent: false })).toBe(true);
    expect(takesHostOnJoin({ owner: true, identity: "u_o", hostIdentity: "u_h", hostPresent: false })).toBe(true);
    expect(takesHostOnJoin({ owner: false, identity: "u_o", hostIdentity: null, hostPresent: false })).toBe(false);
  });

  it("у присутствующего хоста владелец молча права не отбирает", () => {
    expect(takesHostOnJoin({ owner: true, identity: "u_o", hostIdentity: "u_h", hostPresent: true })).toBe(false);
  });

  it("уже хост — менять нечего", () => {
    expect(takesHostOnJoin({ owner: true, identity: "u_o", hostIdentity: "u_o", hostPresent: false })).toBe(false);
  });
});

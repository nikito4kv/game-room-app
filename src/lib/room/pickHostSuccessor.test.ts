import { describe, expect, it } from "vitest";
import { pickHostSuccessor } from "./pickHostSuccessor";

const at = (ms: number) => new Date(ms);

describe("pickHostSuccessor", () => {
  it("побеждает самый ранний по входу", () => {
    const winner = pickHostSuccessor([
      { identity: "Борис", joinedAt: at(2000) },
      { identity: "Вера", joinedAt: at(1000) },
      { identity: "Анна", joinedAt: at(3000) },
    ]);
    expect(winner?.identity).toBe("Вера");
  });

  it("при одинаковом времени — меньший identity", () => {
    const winner = pickHostSuccessor([
      { identity: "Глеб", joinedAt: at(1000) },
      { identity: "Борис", joinedAt: at(1000) },
    ]);
    expect(winner?.identity).toBe("Борис");
  });

  it("неизвестное время входа считается самым ранним", () => {
    const winner = pickHostSuccessor([
      { identity: "Анна", joinedAt: at(1000) },
      { identity: "Яна" },
    ]);
    expect(winner?.identity).toBe("Яна");
  });

  it("все участники приходят к одному ответу независимо от порядка списка", () => {
    const list = [
      { identity: "c", joinedAt: at(5) },
      { identity: "a", joinedAt: at(5) },
      { identity: "b", joinedAt: at(9) },
    ];
    const reversed = [...list].reverse();
    expect(pickHostSuccessor(list)?.identity).toBe("a");
    expect(pickHostSuccessor(reversed)?.identity).toBe("a");
  });

  it("не меняет исходный список", () => {
    const list = [
      { identity: "b", joinedAt: at(2) },
      { identity: "a", joinedAt: at(1) },
    ];
    pickHostSuccessor(list);
    expect(list.map((p) => p.identity)).toEqual(["b", "a"]);
  });

  it("пустая комната → null", () => {
    expect(pickHostSuccessor([])).toBeNull();
  });

  it("владелец в комнате — место его, даже если вошёл позже", () => {
    const list = [
      { identity: "a", joinedAt: at(1) },
      { identity: "owner", joinedAt: at(9) },
    ];
    expect(pickHostSuccessor(list, "owner")?.identity).toBe("owner");
  });

  it("владельца нет среди присутствующих — обычное правило", () => {
    const list = [
      { identity: "b", joinedAt: at(2) },
      { identity: "a", joinedAt: at(1) },
    ];
    expect(pickHostSuccessor(list, "owner")?.identity).toBe("a");
  });
});

import { describe, expect, it } from "vitest";
import { passwordProblem } from "./roomSettings";

describe("passwordProblem", () => {
  it("пусто — не меняем, коротко и длинно — ошибка", () => {
    expect(passwordProblem("")).toBeNull();
    expect(passwordProblem("abcd")).toBeNull();
    expect(passwordProblem("abc")).toMatch(/хотя бы 4/);
    expect(passwordProblem("x".repeat(129))).toMatch(/не длиннее 128/i);
  });
});

import { describe, expect, it } from "vitest";
import { glueShortWords } from "./typography";

const NB = " ";

describe("glueShortWords", () => {
  it("приклеивает предлог и союз к следующему слову", () => {
    expect(glueShortWords("Вечерняя катка в CS2 с Тёмой и Никой")).toBe(
      `Вечерняя катка в${NB}CS2 с${NB}Тёмой и${NB}Никой`,
    );
  });

  it("цепочка коротких слов и предлоги из трёх букв", () => {
    expect(glueShortWords("и в клубе для своих")).toBe(`и${NB}в${NB}клубе для${NB}своих`);
  });

  it("не трогает длинные слова, латиницу и конец строки", () => {
    expect(glueShortWords("Катка CS по вечерам")).toBe(`Катка CS по${NB}вечерам`);
    expect(glueShortWords("Играем в")).toBe("Играем в");
    expect(glueShortWords("Без регистрации")).toBe(`Без${NB}регистрации`);
  });
});

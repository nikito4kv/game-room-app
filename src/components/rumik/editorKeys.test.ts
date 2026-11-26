import { describe, expect, it } from "vitest";
import { FIELD_SELECTOR, editorOwnsKey, type KeyNode } from "./editorKeys";

/** Маленький DOM: тег, contenteditable и родитель — больше решению не нужно. */
class Node implements KeyNode<Node> {
  constructor(
    readonly tag: string,
    readonly parent: Node | null = null,
    readonly editable?: string,
  ) {}

  private matches(selector: string): boolean {
    if (selector === "dialog") return this.tag === "dialog";
    if (selector === FIELD_SELECTOR) {
      return ["input", "textarea", "select"].includes(this.tag) || (this.editable !== undefined && this.editable !== "false");
    }
    throw new Error(`селектор не поддержан: ${selector}`);
  }

  closest(selector: string): Node | null {
    if (this.matches(selector)) return this;
    return this.parent?.closest(selector) ?? null;
  }

  contains(other: Node | null): boolean {
    for (let n = other; n; n = n.parent) if (n === this) return true;
    return false;
  }
}

const el = (tag: string, parent: Node, editable?: string) => new Node(tag, parent, editable);

describe("клавиши рисовалки", () => {
  // Главная: рисовалка на странице, окон нет.
  const body = new Node("body");
  const hero = el("div", body);
  const heroCanvas = el("canvas", hero);
  const hex = el("input", hero);
  const button = el("button", hero);

  it("на странице без окон — клавиши рисовалки (фокус на странице или на её кнопке)", () => {
    expect(editorOwnsKey(body, hero, [])).toBe(true);
    expect(editorOwnsKey(heroCanvas, hero, [])).toBe(true);
    expect(editorOwnsKey(button, hero, [])).toBe(true);
  });

  it("в полях ввода — нет: поле HEX, ник, contenteditable", () => {
    expect(editorOwnsKey(hex, hero, [])).toBe(false);
    expect(editorOwnsKey(el("textarea", body), hero, [])).toBe(false);
    const rich = el("div", body, "true");
    expect(editorOwnsKey(el("span", rich), hero, [])).toBe(false);
    expect(editorOwnsKey(el("span", el("div", body, "false")), hero, [])).toBe(true);
  });

  it("открыто чужое окно (настройки, выход) — клавиши его", () => {
    const settings = el("dialog", body);
    expect(editorOwnsKey(body, hero, [settings])).toBe(false);
    expect(editorOwnsKey(el("button", settings), hero, [settings])).toBe(false);
  });

  // Лобби: рисовалка в окне «Ваш Румик», открытка — окно внутри рисовалки.
  const page = new Node("body");
  const lobby = el("dialog", page);
  const editor = el("div", lobby);
  const editorButton = el("button", editor);
  const postcard = el("dialog", editor);
  const poseButton = el("button", postcard);

  it("в окне лобби рисовалка берёт свои клавиши", () => {
    expect(editorOwnsKey(editorButton, editor, [lobby])).toBe(true);
    expect(editorOwnsKey(lobby, editor, [lobby])).toBe(true);
  });

  it("под открыткой — нет, хотя окно лобби тоже открыто и первое в документе", () => {
    // Открытка внутри рисовалки, но рисовалка не внутри открытки.
    expect(editorOwnsKey(poseButton, editor, [lobby, postcard])).toBe(false);
    // Фокус ушёл на подложку открытки (body) — верхнее окно всё равно открытка.
    expect(editorOwnsKey(page, editor, [lobby, postcard])).toBe(false);
  });
});

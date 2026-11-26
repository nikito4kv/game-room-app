import { Onest, Unbounded } from "next/font/google";

// Шрифты сайта — в одном месте: их берут корневой макет и global-error (он
// заменяет корневой макет, когда тот упал). Каждый next/font отдаёт
// CSS-переменную, на которую ссылаются токены (design-system/tokens.css).
//
// Unbounded — широкий гротеск для названий комнат, крупных заголовков и кода;
// Onest — спокойный интерфейсный шрифт, рисовался под кириллицу. Оба
// вариативные, поэтому weight не указываем. Шрифты корневого макета next/font
// предзагружает на каждой странице.
const brandFont = Unbounded({
  subsets: ["latin", "cyrillic"],
  variable: "--font-unbounded",
  display: "swap",
});

const bodyFont = Onest({
  subsets: ["latin", "cyrillic"],
  variable: "--font-onest",
  display: "swap",
});

/** Классы для <html>: CSS-переменные шрифтов. */
export const fontVariables = `${brandFont.variable} ${bodyFont.variable}`;

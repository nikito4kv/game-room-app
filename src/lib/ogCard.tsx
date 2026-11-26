/**
 * OG-карточки (ImageResponse/satori) в стиле «Эфир»: графитовый фон, белый
 * текст, лаймовый «эфир» только у того, кто говорит. Общие куски для
 * карточки сайта и карточки комнаты. Модуль серверный: читает логотип с диска.
 *
 * Satori не знает CSS-переменных и Tailwind, поэтому цвета — копией значений
 * тёмной темы из design-system/tokens.css (тест сверяет их с файлом токенов).
 * У каждого блока с несколькими детьми — display: flex: так требует satori.
 */
/* eslint-disable @next/next/no-img-element -- это разметка для satori (из неё
   рисуется PNG), а не страница: next/image здесь не работает. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReactNode } from "react";
import { assignAvatarColors, initialsOf } from "@/components/ui/avatarColor";
import { seatAngles, seatPoint } from "@/components/ui/tableLayout";
// Неразрывный пробел после «в», «с», «и»…: satori, как и браузер, не рвёт на нём строку.
import { glueShortWords } from "@/components/ui/typography";
import type { RoomPublicMeta } from "@/lib/api/contract";
import { OG_FONT_BODY, OG_FONT_BRAND } from "./ogFont";

export const OG_SIZE = { width: 1200, height: 630 } as const;

/** Значения токенов тёмной темы (--gr-*). */
export const OG = {
  canvas: "#0d0e11",
  sunken: "#090a0d",
  ink: "#eff0f3",
  ink2: "#b4b7be",
  ink3: "#8d9198",
  signal: "#bcf736",
  avatarInk: "#14161b",
  lineStrong: "rgba(255, 255, 255, 0.14)",
  avatars: [
    "#ffa098",
    "#f9a870",
    "#e1b75c",
    "#71d6a3",
    "#47d6cf",
    "#52cff3",
    "#89c3fe",
    "#b0b7ff",
    "#d5a8f8",
    "#f19fd6",
  ],
} as const;

const PAD = 72;

// Прозрачность в градиентах — только белым с нулевой альфой: «transparent»
// satori считает прозрачным ЧЁРНЫМ, и переход к белому темнеет посередине.
const WHITE = (alpha: number) => `rgba(255, 255, 255, ${alpha})`;

// Логотип — тот же файл, что в public/brand: знак и надпись «game room».
let logoUri: Promise<string> | null = null;
function loadLogo(): Promise<string> {
  logoUri ??= readFile(join(process.cwd(), "public", "brand", "logo-dark.svg")).then(
    (svg) => `data:image/svg+xml;base64,${svg.toString("base64")}`,
  );
  return logoUri;
}

/** Холст карточки: фон, «свет лампы» и логотип в углу. Satori рисует синхронно, поэтому логотип загружен заранее. */
function Frame({
  logo,
  lamp = true,
  children,
}: {
  logo: string;
  /** Мягкий свет сверху справа. У карточки сайта свой свет — над столом. */
  lamp?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        padding: PAD,
        backgroundColor: OG.canvas,
        ...(lamp ? { backgroundImage: `radial-gradient(circle at 78% 18%, ${WHITE(0.07)}, ${WHITE(0)} 52%)` } : {}),
        color: OG.ink,
        fontFamily: OG_FONT_BODY,
      }}
    >
      {/* 172×32 — пропорции logo-dark.svg */}
      <img src={logo} width={236} height={44} alt="" style={{ display: "flex" }} />
      {children}
    </div>
  );
}

// Подложка мини-стола в единицах стола (100 = сторона): свет лампы радиусом 62
// и сам стол — круг 48% с мягким ободком (как TablePreview на лендинге).
const TABLE_BACKDROP = `data:image/svg+xml;base64,${Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 124 124">
  <defs>
    <radialGradient id="lamp"><stop offset="0" stop-color="#fff" stop-opacity="0.06"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <radialGradient id="rim"><stop offset="0.62" stop-color="#fff" stop-opacity="0.012"/><stop offset="1" stop-color="#fff" stop-opacity="0.07"/></radialGradient>
  </defs>
  <circle cx="62" cy="62" r="62" fill="url(#lamp)"/>
  <circle cx="62" cy="62" r="24" fill="url(#rim)" stroke="#fff" stroke-opacity="0.1" stroke-width="0.5"/>
</svg>`,
).toString("base64")}`;

const DEMO_NAMES = ["Тёма", "Ника", "Лёха", "Даня Котов"];

/** Круглый стол с четырьмя друзьями, один говорит — как мини-стол на лендинге. */
function DemoTable({ size }: { size: number }) {
  const colors = assignAvatarColors(DEMO_NAMES);
  const angles = seatAngles(DEMO_NAMES.length);
  const avatar = Math.round(size * 0.2);
  const ring = Math.max(4, Math.round(avatar * 0.055));
  return (
    <div style={{ display: "flex", position: "relative", width: size, height: size }}>
      {/* Свет над столом и сам стол — SVG-картинкой: радиальные градиенты satori
          рисует с резкими краями, а resvg по SVG — мягко, как браузер. */}
      <img
        src={TABLE_BACKDROP}
        width={size * 1.24}
        height={size * 1.24}
        alt=""
        style={{ position: "absolute", left: -size * 0.12, top: -size * 0.12 }}
      />
      {DEMO_NAMES.map((name, i) => {
        const p = seatPoint(angles[i]);
        const speaking = i === 0;
        const initials = initialsOf(name);
        return (
          <div
            key={name}
            style={{
              position: "absolute",
              left: (p.left / 100) * size - avatar / 2,
              top: (p.top / 100) * size - avatar / 2,
              width: avatar,
              height: avatar,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 9999,
              backgroundColor: OG.avatars[colors[i]],
              color: OG.avatarInk,
              fontFamily: OG_FONT_BRAND,
              fontWeight: 600,
              fontSize: Math.round(avatar * (initials.length > 1 ? 0.34 : 0.42)),
              // Кольцо «говорит»: зазор цвета фона + лаймовое кольцо + тонкая волна.
              // undefined satori не принимает — свойство только у говорящего.
              ...(speaking
                ? {
                    boxShadow: `0 0 0 ${ring}px ${OG.canvas}, 0 0 0 ${ring * 2}px ${OG.signal}, 0 0 0 ${ring * 3.5}px rgba(188, 247, 54, 0.28)`,
                  }
                : {}),
            }}
          >
            {initials}
          </div>
        );
      })}
      {/* Имён нет: в превью мессенджера они были бы мельче 10 px. */}
    </div>
  );
}

/** Карточка сайта: главная, витрина, любая ссылка без своей картинки. */
export async function siteCard() {
  const logo = await loadLogo();
  return (
    <Frame logo={logo} lamp={false}>
      <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 640 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontFamily: OG_FONT_BRAND,
              fontWeight: 700,
              fontSize: 80,
              lineHeight: 1.04,
              letterSpacing: "-0.03em",
            }}
          >
            <span>Заходи,</span>
            <span>тут все свои</span>
          </div>
          <div style={{ display: "flex", marginTop: 32, fontSize: 32, lineHeight: 1.4, color: OG.ink2 }}>
            {glueShortWords("Голосовая комната для своей компании. Без регистрации, прямо в браузере.")}
          </div>
        </div>
        <DemoTable size={400} />
      </div>
    </Frame>
  );
}

/** Размер названия комнаты: длинное — мельче, чтобы влезло в две строки. */
export function roomTitleSize(title: string): number {
  const length = Array.from(title).length;
  if (length <= 14) return 96;
  if (length <= 24) return 76;
  return 60;
}

/** Карточка комнаты: «Вас зовут в комнату» + название + код. */
export async function roomCard(room: Pick<RoomPublicMeta, "title" | "hasPassword">, code: string) {
  const logo = await loadLogo();
  return (
    <Frame logo={logo}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
        <div style={{ display: "flex", fontSize: 34, fontWeight: 500, color: OG.ink3 }}>Вас зовут в комнату</div>
        <div
          style={{
            display: "block",
            marginTop: 14,
            fontFamily: OG_FONT_BRAND,
            fontWeight: 700,
            fontSize: roomTitleSize(room.title),
            lineHeight: 1.08,
            letterSpacing: "-0.02em",
            maxWidth: OG_SIZE.width - PAD * 2,
            // Не больше двух строк: длинное название обрезается многоточием.
            lineClamp: 2,
            overflow: "hidden",
          }}
        >
          {glueShortWords(room.title)}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <div
          style={{
            display: "flex",
            padding: "12px 28px",
            borderRadius: 20,
            border: `2px solid ${OG.lineStrong}`,
            backgroundColor: OG.sunken,
            fontFamily: OG_FONT_BRAND,
            fontWeight: 600,
            fontSize: 48,
            letterSpacing: "0.16em",
            // Разрядка добавляет пробел и после последней буквы — компенсируем.
            paddingRight: 20,
          }}
        >
          {code}
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 28, lineHeight: 1.3, color: OG.ink3 }}>
          <span>Код комнаты</span>
          <span>{room.hasPassword ? "Вход по паролю" : "Без регистрации"}</span>
        </div>
      </div>
    </Frame>
  );
}

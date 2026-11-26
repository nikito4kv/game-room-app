import type { CSSProperties, ReactNode } from "react";
import { glue, parseRich, useFormat, useSpring } from "../fx";
import { Icon, type IconName } from "./Icon";

/** Появление блока: плавно из прозрачности со сдвигом вверх (пружина без отскока). */
export function Appear({
  delay = 0,
  dy = 22,
  children,
  style,
}: {
  delay?: number;
  dy?: number;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const p = useSpring(delay);
  return (
    <div style={{ opacity: p, transform: `translateY(${(1 - p) * dy}px)`, ...style }}>{children}</div>
  );
}

/** Подпись-«бровка» над заголовком: маленькая капитель Onest с точкой цвета эфира. */
export function Kicker({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const { tall } = useFormat();
  return (
    <Appear delay={delay} dy={12}>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 14,
          fontFamily: "var(--gr-font-body)",
          fontWeight: 500,
          fontSize: tall ? 32 : 26,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--gr-ink-2)",
        }}
      >
        <span
          style={{
            width: tall ? 14 : 12,
            height: tall ? 14 : 12,
            borderRadius: "50%",
            background: "var(--gr-signal)",
          }}
        />
        {children}
      </div>
    </Appear>
  );
}

/** Заголовок Unbounded: слова выезжают по очереди. *Акцент* — цветом эфира. */
export function Headline({
  text,
  delay = 0,
  size,
  maxWidth,
  align = "left",
}: {
  text: string;
  delay?: number;
  size?: number;
  maxWidth?: number;
  align?: "left" | "center";
}) {
  const fs = size ?? 76;
  const words = parseRich(text);
  return (
    <h1
      style={{
        margin: 0,
        maxWidth,
        textAlign: align,
        fontFamily: "var(--gr-font-brand)",
        fontWeight: 600,
        fontSize: fs,
        lineHeight: 1.1,
        letterSpacing: "-0.015em",
        color: "var(--gr-ink)",
      }}
    >
      {words.map((w, i) => (
        <WordSpan key={i} word={w.text} accent={w.accent} delay={delay + i * 3} br={w.breakAfter} />
      ))}
    </h1>
  );
}

function WordSpan({ word, accent, delay, br }: { word: string; accent: boolean; delay: number; br: boolean }) {
  const p = useSpring(delay);
  return (
    <>
      <span style={{ display: "inline-block", whiteSpace: "nowrap", overflow: "hidden", verticalAlign: "top", padding: "0.14em 0.04em", margin: "-0.14em -0.04em" }}>
        <span
          style={{
            display: "inline-block",
            opacity: p,
            transform: `translateY(${(1 - p) * 70}%)`,
            color: accent ? "var(--gr-signal)" : undefined,
          }}
        >
          {word}
        </span>
      </span>
      {br ? <br /> : " "}
    </>
  );
}

/** Подзаголовок Onest. */
export function Sub({
  children,
  delay = 0,
  size,
  maxWidth,
  align = "left",
}: {
  children: string;
  delay?: number;
  size?: number;
  maxWidth?: number;
  align?: "left" | "center";
}) {
  const { tall } = useFormat();
  return (
    <Appear delay={delay} dy={16}>
      <p
        style={{
          margin: 0,
          maxWidth,
          textAlign: align,
          fontFamily: "var(--gr-font-body)",
          fontWeight: 400,
          fontSize: size ?? (tall ? 40 : 34),
          lineHeight: 1.35,
          color: "var(--gr-ink-2)",
        }}
      >
        {glue(children)}
      </p>
    </Appear>
  );
}

/** Таблетка: значок и короткий текст. tone — смысл цвета по дизайн-системе. */
export function Chip({
  icon,
  children,
  tone = "neutral",
  size = 28,
  delay = 0,
}: {
  icon?: IconName;
  children: ReactNode;
  tone?: "neutral" | "alert" | "signal" | "caution";
  size?: number;
  delay?: number;
}) {
  const color =
    tone === "alert"
      ? "var(--gr-alert-ink)"
      : tone === "signal"
        ? "var(--gr-signal-ink)"
        : tone === "caution"
          ? "var(--gr-caution-ink)"
          : "var(--gr-ink)";
  const bg =
    tone === "alert"
      ? "var(--gr-alert-wash)"
      : tone === "signal"
        ? "var(--gr-signal-wash)"
        : tone === "caution"
          ? "var(--gr-caution-wash)"
          : "var(--gr-wash-2)";
  return (
    <Appear delay={delay} dy={14}>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: size * 0.4,
          padding: `${size * 0.42}px ${size * 0.7}px`,
          borderRadius: 999,
          background: bg,
          border: "1px solid var(--gr-line-strong)",
          color,
          fontFamily: "var(--gr-font-body)",
          fontWeight: 500,
          fontSize: size,
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        {icon && <Icon name={icon} size={Math.round(size * 1.1)} sw={2} />}
        {children}
      </div>
    </Appear>
  );
}

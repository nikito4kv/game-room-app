import type { ReactNode } from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { SAFE_TALL, prog, useFormat } from "../fx";
import { Headline, Kicker, Sub } from "./Type";

/** Графитовая комната: тёмный фон, статичный свет лампы и виньетка. Почти не двигается. */
export function Backdrop({ lampX = 0.68, lampY = 0.5 }: { lampX?: number; lampY?: number }) {
  const frame = useCurrentFrame();
  const { width, height, tall } = useFormat();
  // Лампа едва заметно «дышит»: 1,5 % за 6 секунд, чтобы кадр не был мёртвым.
  const breathe = 1 + Math.sin(frame / 55) * 0.015;
  const cx = (tall ? 0.5 : lampX) * width;
  const cy = (tall ? 0.46 : lampY) * height;
  const r = Math.max(width, height) * 0.62 * breathe;
  return (
    <AbsoluteFill style={{ background: "var(--gr-canvas)" }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(${r}px ${r * 0.85}px at ${cx}px ${cy}px, rgb(255 255 255 / 0.06), transparent 70%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: "radial-gradient(130% 110% at 50% 50%, transparent 55%, rgb(0 0 0 / 0.5))",
        }}
      />
    </AbsoluteFill>
  );
}

/**
 * Раскадровка: сцены идут встык с небольшим перекрытием, чтобы переходы были
 * плавными (кроссфейд), а не «чёрные провалы».
 */
export function timeline(durs: number[], overlap = 9) {
  let t = 0;
  const items = durs.map((d) => {
    const from = t;
    t += d - overlap;
    return { from, dur: d };
  });
  return { items, total: t + overlap };
}

/** Сцена: Sequence + мягкое появление в начале и растворение в конце. */
export function Scene({
  from,
  dur,
  fade = 9,
  first = false,
  last = false,
  children,
}: {
  from: number;
  dur: number;
  fade?: number;
  first?: boolean;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <Sequence from={from} durationInFrames={dur} layout="none">
      <FadeWrap dur={dur} fade={fade} first={first} last={last}>
        {children}
      </FadeWrap>
    </Sequence>
  );
}

function FadeWrap({
  dur,
  fade,
  first,
  last,
  children,
}: {
  dur: number;
  fade: number;
  first: boolean;
  last: boolean;
  children: ReactNode;
}) {
  const frame = useCurrentFrame();
  const inP = first ? 1 : prog(frame, 0, fade);
  const outP = last ? 0 : prog(frame, dur - fade, dur - 1);
  const opacity = Math.min(inP, 1 - outP);
  const scale = 0.988 + 0.012 * inP + 0.008 * outP;
  return <AbsoluteFill style={{ opacity, transform: `scale(${scale})` }}>{children}</AbsoluteFill>;
}

/** Размер области под «картинку» сцены в разных форматах. */
export function useVisualBox() {
  const { tall, square } = useFormat();
  if (tall) return { w: 936, h: 760 };
  if (square) return { w: 880, h: 880 };
  return { w: 860, h: 880 };
}

/**
 * Каркас сцены «текст + картинка». Широкий формат: текст слева, картинка справа.
 * Вертикальный: всё внутри безопасной зоны (сверху 260, снизу 350 px) — текст
 * сверху, картинка под ним по центру.
 */
export function Split({
  text,
  visual,
  textWidth = 820,
  reverse = false,
}: {
  text: ReactNode;
  visual: ReactNode;
  textWidth?: number;
  reverse?: boolean;
}) {
  const { tall } = useFormat();
  if (tall) {
    return (
      <AbsoluteFill
        style={{
          padding: `${SAFE_TALL.top}px ${SAFE_TALL.side}px ${SAFE_TALL.bottom}px`,
          display: "flex",
          flexDirection: "column",
          gap: 28,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>{text}</div>
        <div style={{ flex: 1, minHeight: 0, display: "grid", placeItems: "center", position: "relative" }}>
          {visual}
        </div>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill
      style={{
        padding: "0 110px",
        display: "flex",
        flexDirection: reverse ? "row-reverse" : "row",
        alignItems: "center",
        gap: 40,
      }}
    >
      <div style={{ width: textWidth, flexShrink: 0, display: "flex", flexDirection: "column", gap: 28 }}>
        {text}
      </div>
      <div style={{ flex: 1, minWidth: 0, height: "100%", display: "grid", placeItems: "center", position: "relative" }}>
        {visual}
      </div>
    </AbsoluteFill>
  );
}

/** Стандартный текстовый блок сцены: бровка, заголовок, подзаголовок. */
export function TextBlock({
  kicker,
  title,
  sub,
  delay = 4,
  titleSize,
  subWidth,
}: {
  kicker?: string;
  title: string;
  sub?: string;
  delay?: number;
  titleSize?: number;
  subWidth?: number;
}) {
  const { tall } = useFormat();
  return (
    <>
      {kicker && <Kicker delay={delay}>{kicker}</Kicker>}
      <Headline text={title} delay={delay + 4} size={titleSize} maxWidth={tall ? 936 : 820} />
      {sub && (
        <Sub delay={delay + 16} maxWidth={subWidth ?? (tall ? 900 : 700)}>
          {sub}
        </Sub>
      )}
    </>
  );
}

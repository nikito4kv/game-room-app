import type { ReactNode } from "react";
import { useCurrentFrame } from "remotion";
import { SHARED } from "../copy";
import { Avatar, type AvatarStatus } from "./Avatar";
import { Icon, type IconName } from "./Icon";
import { RoundIcon } from "./Frames";
import { clamp, hash01, prog, voiceLevel } from "../fx";

/** Тост как в продукте: bg-overlay, радиус 16, тень float, ник в заголовке, событие в описании. */
export function Toast({
  title,
  text,
  scale = 1,
  person,
  icon,
  tone = "neutral",
}: {
  title: string;
  text: string;
  scale?: number;
  person?: { name: string; color: number };
  icon?: IconName;
  tone?: "neutral" | "caution";
}) {
  const s = scale;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 18 * s,
        padding: `${16 * s}px ${24 * s}px ${16 * s}px ${16 * s}px`,
        borderRadius: 18 * s,
        background: "var(--gr-overlay)",
        boxShadow: "var(--gr-shadow-float)",
        fontFamily: "var(--gr-font-body)",
        minWidth: 360 * s,
      }}
    >
      {person && <Avatar name={person.name} color={person.color} size={56 * s} cutout="var(--gr-overlay)" />}
      {icon && (
        <div
          style={{
            width: 56 * s,
            height: 56 * s,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            background: tone === "caution" ? "var(--gr-caution-wash)" : "var(--gr-wash-2)",
            color: tone === "caution" ? "var(--gr-caution-ink)" : "var(--gr-ink)",
          }}
        >
          <Icon name={icon} size={28 * s} sw={2} />
        </div>
      )}
      <div>
        <div style={{ fontSize: 28 * s, fontWeight: 500, color: "var(--gr-ink)", lineHeight: 1.2 }}>{title}</div>
        <div style={{ fontSize: 24 * s, color: "var(--gr-ink-2)", lineHeight: 1.25, marginTop: 2 * s }}>{text}</div>
      </div>
    </div>
  );
}

/**
 * Мини-комната поверх игры (Document PiP, Chrome/Edge): название и связь,
 * ряд аватаров с кольцом у говорящего, внизу микрофон, звук и «Говорит …».
 * Эталон — PipContent в src/app/design/_mocks/PipMock.tsx.
 */
export function MiniRoom({ width = 520, speaker = 0 }: { width?: number; speaker?: number }) {
  const frame = useCurrentFrame();
  const k = width / 360;
  const people = SHARED.people;
  const statuses: (AvatarStatus | null)[] = [null, null, "muted", "deafened", null];
  return (
    <div
      style={{
        width,
        borderRadius: 14 * k,
        background: "var(--gr-raised)",
        border: "1px solid var(--gr-line-strong)",
        boxShadow: "0 30px 70px -20px rgb(0 0 0 / 0.8)",
        overflow: "hidden",
        fontFamily: "var(--gr-font-body)",
      }}
    >
      <div
        style={{
          height: 34 * k,
          display: "flex",
          alignItems: "center",
          gap: 8 * k,
          padding: `0 ${12 * k}px`,
          background: "var(--gr-overlay)",
          color: "var(--gr-ink-2)",
          fontSize: 13 * k,
        }}
      >
        <Icon name="arrow-left" size={15 * k} sw={2} />
        <span style={{ flex: 1 }}>{SHARED.url}</span>
        <Icon name="x" size={15 * k} sw={2} />
      </div>
      <div style={{ padding: `${14 * k}px ${16 * k}px ${14 * k}px` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 * k, color: "var(--gr-ink)", fontSize: 15 * k, fontWeight: 500 }}>
          <span
            style={{ width: 10 * k, height: 10 * k, borderRadius: "50%", background: "var(--gr-signal)", display: "inline-block" }}
          />
          {SHARED.roomName}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 * k }}>
          {people.map((p, i) => {
            const on = i === speaker;
            return (
              <div key={p.name} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 * k }}>
                <Avatar
                  name={p.name}
                  color={p.color}
                  size={46 * k}
                  speak={on ? 1 : 0}
                  level={voiceLevel(frame, i)}
                  status={statuses[i]}
                  seed={i}
                  cutout="var(--gr-raised)"
                />
                <span style={{ fontSize: 12.5 * k, color: on ? "var(--gr-ink)" : "var(--gr-ink-2)" }}>{p.name}</span>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 * k, marginTop: 16 * k }}>
          <RoundIcon name="mic" size={40 * k} />
          <RoundIcon name="headphones" size={40 * k} />
          <span style={{ fontSize: 13.5 * k, color: "var(--gr-ink-2)" }}>
            Говорит <span style={{ color: "var(--gr-ink)" }}>{people[speaker].name}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Шумодав в картинке. Слева дорожка с шумом (серые рваные полоски), посередине
 * «ворота» шумодава, справа остаётся тихая спокойная волна голоса цвета эфира.
 * Полоски плывут слева направо; всё считается от номера кадра.
 */
export function NoiseViz({
  width,
  height,
  labels,
  progress = 1,
}: {
  width: number;
  height: number;
  labels: { before: string; gate: string; after: string };
  /** 0…1: насколько «включён» шумодав (для плавного появления). */
  progress?: number;
}) {
  const frame = useCurrentFrame();
  const N = Math.round(width / 15);
  const barW = (width / N) * 0.55;
  const shift = frame * 0.55;
  const mid = height * 0.46;

  const voice = (u: number) => {
    const burst = 0.5 + 0.5 * Math.sin(u * 0.33) * Math.sin(u * 0.11 + 1.2);
    return clamp(0.08 + 0.82 * Math.max(0, burst) ** 1.3, 0.05, 1);
  };
  const noise = (u: number) =>
    clamp(0.22 + 0.55 * Math.abs(Math.sin(u * 5.3) * Math.sin(u * 2.9 + 1.3)) + 0.3 * hash01(Math.floor(u * 1.8)), 0, 1);
  const smooth = (x: number) => x * x * (3 - 2 * x);

  return (
    <div style={{ position: "relative", width, height }}>
      {Array.from({ length: N }, (_, j) => {
        const x01 = (j + 0.5) / N;
        const u = j - shift;
        const gate = smooth(clamp((x01 - 0.44) / 0.12)) * progress;
        const noisy = 1 - gate;
        const v = voice(u);
        const hVoice = Math.max(8, v * mid * 1.7);
        const hTotal = Math.max(8, (v * 0.55 + noise(u) * noisy * 0.9) * mid * 1.7);
        return (
          <div key={j}>
            <div
              style={{
                position: "absolute",
                left: x01 * width - barW / 2,
                top: mid - hTotal / 2,
                width: barW,
                height: hTotal,
                borderRadius: barW,
                background: "var(--gr-ink-3)",
                opacity: 0.55 * noisy,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: x01 * width - barW / 2,
                top: mid - hVoice / 2,
                width: barW,
                height: hVoice,
                borderRadius: barW,
                background: "var(--gr-signal)",
                opacity: 1 - noisy,
              }}
            />
          </div>
        );
      })}
      {/* Ворота шумодава */}
      <div
        style={{
          position: "absolute",
          left: width * 0.5 - 3,
          top: 0,
          width: 6,
          height: mid * 2,
          borderRadius: 3,
          background: "var(--gr-ink)",
          opacity: 0.85 * prog(frame, 0, 12),
        }}
      />
      <Label x={width * 0.18} y={mid * 2 + 28} text={labels.before} />
      <Label x={width * 0.5} y={mid * 2 + 28} text={labels.gate} strong />
      <Label x={width * 0.82} y={mid * 2 + 28} text={labels.after} signal />
    </div>
  );
}

function Label({ x, y, text, strong, signal }: { x: number; y: number; text: string; strong?: boolean; signal?: boolean }): ReactNode {
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: "translateX(-50%)",
        fontFamily: "var(--gr-font-body)",
        fontWeight: 500,
        fontSize: 30,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        color: signal ? "var(--gr-signal-ink)" : strong ? "var(--gr-ink)" : "var(--gr-ink-3)",
      }}
    >
      {text}
    </div>
  );
}

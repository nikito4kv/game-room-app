import type { CSSProperties, ReactNode } from "react";
import { Img, staticFile } from "remotion";
import { Icon, type IconName } from "./Icon";

/**
 * Окно браузера с настоящим скриншотом интерфейса (public/promo/shots/*.png,
 * сняты Playwright'ом с макетов /design/* в @2x).
 * children — слой поверх скриншота; координаты в процентах от самого экрана.
 */
export function BrowserFrame({
  shot,
  width,
  aspect = 1440 / 900,
  url = "game-room.space",
  children,
  style,
  imgStyle,
}: {
  shot: string;
  width: number;
  aspect?: number;
  url?: string;
  children?: ReactNode;
  style?: CSSProperties;
  imgStyle?: CSSProperties;
}) {
  const bar = Math.round(width * 0.046);
  const screenH = Math.round(width / aspect);
  return (
    <div
      style={{
        width,
        borderRadius: Math.round(width * 0.018),
        overflow: "hidden",
        background: "var(--gr-raised)",
        border: "1px solid var(--gr-line-strong)",
        boxShadow: "0 40px 90px -30px rgb(0 0 0 / 0.85), 0 0 0 1px rgb(0 0 0 / 0.5)",
        ...style,
      }}
    >
      <div
        style={{
          height: bar,
          display: "flex",
          alignItems: "center",
          gap: bar * 0.22,
          padding: `0 ${bar * 0.45}px`,
          background: "var(--gr-overlay)",
          borderBottom: "1px solid var(--gr-line)",
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{ width: bar * 0.26, height: bar * 0.26, borderRadius: "50%", background: "var(--gr-wash-3)" }}
          />
        ))}
        <div
          style={{
            marginLeft: bar * 0.4,
            flex: 1,
            maxWidth: width * 0.55,
            height: bar * 0.62,
            borderRadius: 999,
            background: "var(--gr-sunken)",
            display: "flex",
            alignItems: "center",
            gap: bar * 0.2,
            padding: `0 ${bar * 0.35}px`,
            color: "var(--gr-ink-2)",
            fontFamily: "var(--gr-font-body)",
            fontSize: bar * 0.34,
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          <Icon name="lock" size={bar * 0.32} sw={2.2} />
          {url}
        </div>
      </div>
      <div style={{ position: "relative", width, height: screenH, background: "var(--gr-canvas)" }}>
        <Img
          src={staticFile(`promo/shots/${shot}`)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", ...imgStyle }}
        />
        {children}
      </div>
    </div>
  );
}

/** Круглая кнопка/значок: фон-«стекло» графита. */
export function RoundIcon({
  name,
  size = 72,
  tone = "neutral",
}: {
  name: IconName;
  size?: number;
  tone?: "neutral" | "alert" | "signal";
}) {
  const bg =
    tone === "alert" ? "var(--gr-alert)" : tone === "signal" ? "var(--gr-signal)" : "var(--gr-wash-3)";
  const fg =
    tone === "alert" ? "var(--gr-on-alert)" : tone === "signal" ? "var(--gr-on-signal)" : "var(--gr-ink)";
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: bg,
        color: fg,
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
      }}
    >
      <Icon name={name} size={Math.round(size * 0.46)} sw={2} />
    </div>
  );
}

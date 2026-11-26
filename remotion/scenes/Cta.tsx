import { AbsoluteFill } from "remotion";
import { COPY, SHARED } from "../copy";
import { Icon } from "../components/Icon";
import { Lockup } from "../components/Logo";
import { Appear, Chip, Headline } from "../components/Type";
import { SAFE_TALL, useFormat, useSpring } from "../fx";

/** Призыв: логотип, «Создай комнату. Отправь ссылку.», кнопка и адрес. */
export function SceneCta({ url = SHARED.url }: { url?: string }) {
  const { tall } = useFormat();
  const btn = useSpring(34, { damping: 18, stiffness: 130 });
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        padding: tall ? `${SAFE_TALL.top}px ${SAFE_TALL.side}px ${SAFE_TALL.bottom}px` : "0 120px",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: tall ? 44 : 36, textAlign: "center" }}>
        <Appear delay={0} dy={20}>
          <Lockup height={tall ? 92 : 84} id="cta" />
        </Appear>
        <Headline text={COPY.cta.title} delay={8} align="center" size={tall ? 92 : 96} maxWidth={tall ? 936 : 1300} />
        <div
          style={{
            opacity: btn,
            transform: `translateY(${(1 - btn) * 24}px) scale(${0.96 + 0.04 * btn})`,
            display: "inline-flex",
            alignItems: "center",
            gap: 20,
            padding: tall ? "34px 56px" : "30px 52px",
            borderRadius: 22,
            background: "var(--gr-ink)",
            color: "var(--gr-inverse)",
            fontFamily: "var(--gr-font-body)",
            fontWeight: 500,
            fontSize: tall ? 46 : 42,
          }}
        >
          <Icon name="log-in" size={tall ? 48 : 44} sw={2} />
          {COPY.cta.button}
        </div>
        <Appear delay={44} dy={14}>
          <div style={{ display: "flex", alignItems: "center", gap: 26, flexWrap: "wrap", justifyContent: "center" }}>
            <span
              style={{
                fontFamily: "var(--gr-font-brand)",
                fontWeight: 600,
                fontSize: tall ? 44 : 42,
                color: "var(--gr-ink)",
                letterSpacing: "-0.01em",
              }}
            >
              {url}
            </span>
          </div>
        </Appear>
        <Chip icon="check" tone="signal" size={tall ? 32 : 28} delay={54}>
          {COPY.cta.note}
        </Chip>
      </div>
    </AbsoluteFill>
  );
}

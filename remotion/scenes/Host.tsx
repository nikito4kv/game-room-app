import { useCurrentFrame } from "remotion";
import { COPY, SHARED } from "../copy";
import { Avatar } from "../components/Avatar";
import { RoundIcon } from "../components/Frames";
import { Icon } from "../components/Icon";
import { Split, TextBlock, useVisualBox } from "../components/Scene";
import { Appear } from "../components/Type";
import { Toast } from "../components/Widgets";
import { prog, useFormat, usePop, useSpring } from "../fx";

function Action({ icon, label, delay, active, size }: { icon: "user-x" | "ban" | "lock"; label: string; delay: number; active: number; size: number }) {
  const p = usePop(delay);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 18,
        opacity: Math.min(1, p),
        transform: `scale(${0.6 + 0.4 * p})`,
        fontFamily: "var(--gr-font-body)",
        fontWeight: 500,
        fontSize: size * 0.26,
        color: "var(--gr-ink)",
      }}
    >
      <div style={{ position: "relative" }}>
        <div
          style={{
            position: "absolute",
            inset: -8,
            borderRadius: "50%",
            border: "3px solid var(--gr-caution)",
            opacity: active,
            transform: `scale(${1 + (1 - active) * 0.3})`,
          }}
        />
        <RoundIcon name={icon} size={size} tone={icon === "lock" ? "neutral" : "alert"} />
      </div>
      {label}
    </div>
  );
}

/**
 * Решение 5: права хоста. Выгнать, забанить, закрыть вход — круглыми значками.
 * Тост «Вход закрыт» — тот же текст, что в продукте.
 */
export function SceneHost() {
  const frame = useCurrentFrame();
  const { tall } = useFormat();
  const box = useVisualBox();
  const W = Math.min(box.w, tall ? 936 : 820);
  const btn = tall ? 128 : 116;
  const toastIn = useSpring(54, { damping: 20, stiffness: 120 });
  const active = prog(frame, 56, 70);
  const host = SHARED.people[0];
  return (
    <Split
      text={<TextBlock kicker={COPY.host.kicker} title={COPY.host.title} sub={COPY.host.sub} />}
      visual={
        <div style={{ width: W, display: "flex", flexDirection: "column", gap: 28 }}>
          <Appear delay={6} dy={30}>
            <div
              style={{
                padding: "36px 40px 44px",
                borderRadius: 28,
                background: "var(--gr-raised)",
                border: "1px solid var(--gr-line-strong)",
                boxShadow: "var(--gr-shadow-raised)",
                display: "flex",
                flexDirection: "column",
                gap: 34,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
                <Avatar name={host.name} color={host.color} size={84} cutout="var(--gr-raised)" />
                <div style={{ fontFamily: "var(--gr-font-body)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 38, fontWeight: 500, color: "var(--gr-ink)" }}>
                    <span style={{ color: "var(--gr-crown)", display: "grid" }}>
                      <Icon name="crown" size={34} sw={2} />
                    </span>
                    {host.name}
                  </div>
                  <div style={{ fontSize: 28, color: "var(--gr-ink-2)", marginTop: 4 }}>Вы хост</div>
                </div>
              </div>
              <div style={{ height: 1, background: "var(--gr-line-strong)" }} />
              <div style={{ display: "flex", justifyContent: "space-around" }}>
                {COPY.host.actions.map((a, i) => (
                  <Action
                    key={a.label}
                    icon={a.icon as "user-x" | "ban" | "lock"}
                    label={a.label}
                    delay={18 + i * 8}
                    active={a.icon === "lock" ? active : 0}
                    size={btn}
                  />
                ))}
              </div>
            </div>
          </Appear>
          <div style={{ display: "flex", justifyContent: "center", opacity: toastIn, transform: `translateY(${(1 - toastIn) * 26}px)` }}>
            <Toast title={COPY.host.toastTitle} text={COPY.host.toastText} icon="lock" tone="caution" scale={tall ? 1.1 : 1} />
          </div>
        </div>
      }
    />
  );
}

import { useCurrentFrame } from "remotion";
import { COPY } from "../copy";
import { Icon } from "../components/Icon";
import { Split, TextBlock, useVisualBox } from "../components/Scene";
import { Appear } from "../components/Type";
import { prog, useFormat } from "../fx";

/** Боль: пока все зарегистрируются и всё поставят, вечер прошёл. Шаги по очереди вычёркиваются. */
export function ScenePain() {
  const frame = useCurrentFrame();
  const { tall } = useFormat();
  const box = useVisualBox();
  const w = Math.min(box.w, 760);
  const fs = tall ? 40 : 36;
  return (
    <Split
      text={<TextBlock kicker={COPY.pain.kicker} title={COPY.pain.title} titleSize={tall ? 62 : 56} />}
      visual={
        <div style={{ width: w, display: "flex", flexDirection: "column", gap: 20 }}>
          {COPY.pain.steps.map((s, i) => {
            const strike = prog(frame, 44 + i * 8, 56 + i * 8);
            const dim = prog(frame, 48 + i * 8, 60 + i * 8);
            return (
              <Appear key={s} delay={12 + i * 9} dy={26}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 24,
                    padding: "26px 32px",
                    borderRadius: 22,
                    background: "var(--gr-raised)",
                    border: "1px solid var(--gr-line-strong)",
                    boxShadow: "var(--gr-shadow-raised)",
                    fontFamily: "var(--gr-font-body)",
                    fontSize: fs,
                    fontWeight: 500,
                    color: "var(--gr-ink)",
                    opacity: 1 - 0.45 * dim,
                  }}
                >
                  <span
                    style={{
                      width: fs * 1.5,
                      height: fs * 1.5,
                      borderRadius: "50%",
                      background: "var(--gr-wash-3)",
                      display: "grid",
                      placeItems: "center",
                      fontFamily: "var(--gr-font-brand)",
                      fontSize: fs * 0.7,
                      fontWeight: 600,
                    }}
                  >
                    {i + 1}
                  </span>
                  <span style={{ position: "relative" }}>
                    {s}
                    <span
                      style={{
                        position: "absolute",
                        left: -6,
                        top: "52%",
                        height: 3,
                        width: `calc(${strike * 100}% + 12px)`,
                        background: "var(--gr-ink)",
                        borderRadius: 2,
                      }}
                    />
                  </span>
                </div>
              </Appear>
            );
          })}
          <Appear delay={68} dy={26}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 22,
                padding: "28px 34px",
                borderRadius: 22,
                background: "var(--gr-signal-wash)",
                border: "2px solid var(--gr-signal)",
                fontFamily: "var(--gr-font-brand)",
                fontSize: fs * 0.98,
                fontWeight: 600,
                color: "var(--gr-ink)",
              }}
            >
              <span style={{ color: "var(--gr-signal)", display: "grid" }}>
                <Icon name="link" size={fs * 1.3} sw={2.2} />
              </span>
              {COPY.pain.after}
            </div>
          </Appear>
        </div>
      }
    />
  );
}

import { useCurrentFrame } from "remotion";
import { COPY } from "../copy";
import { Split, TextBlock, useVisualBox } from "../components/Scene";
import { NoiseViz } from "../components/Widgets";
import { Appear } from "../components/Type";
import { prog, useFormat } from "../fx";

/** Решение 4: шумодав. Шум слева рваный и серый, после «ворот» остаётся спокойная волна голоса. */
export function SceneNoise() {
  const frame = useCurrentFrame();
  const { tall } = useFormat();
  const box = useVisualBox();
  const W = Math.min(box.w, tall ? 936 : 860);
  const H = tall ? 440 : 480;
  return (
    <Split
      text={<TextBlock kicker={COPY.noise.kicker} title={COPY.noise.title} sub={COPY.noise.sub} />}
      visual={
        <Appear delay={6} dy={30}>
          <div
            style={{
              width: W,
              padding: "44px 40px 36px",
              borderRadius: 28,
              background: "var(--gr-raised)",
              border: "1px solid var(--gr-line-strong)",
              boxShadow: "var(--gr-shadow-raised)",
            }}
          >
            <NoiseViz
              width={W - 80}
              height={H}
              progress={prog(frame, 8, 34)}
              labels={{ before: COPY.noise.before, gate: COPY.noise.gate, after: COPY.noise.after }}
            />
          </div>
        </Appear>
      }
    />
  );
}

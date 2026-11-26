import { useCurrentFrame } from "remotion";
import { COPY, SHARED } from "../copy";
import { Avatar } from "../components/Avatar";
import { GameScreen } from "../components/GameScreen";
import { Icon } from "../components/Icon";
import { Split, TextBlock, useVisualBox } from "../components/Scene";
import { Chip } from "../components/Type";
import { MiniRoom } from "../components/Widgets";
import { useFormat, useSpring } from "../fx";

/**
 * Решение 3: показ экрана 1080p60 и мини-окно поверх игры. Кадр игры —
 * абстрактная заглушка. Плашки «Эфир» и качества — как поверх видео в продукте.
 */
export function SceneScreen() {
  const frame = useCurrentFrame();
  const { tall } = useFormat();
  const box = useVisualBox();
  const W = Math.min(box.w, tall ? 936 : 860);
  const H = Math.round((W * 9) / 16);
  const panelIn = useSpring(4);
  const badgeIn = useSpring(18);
  const qualityIn = useSpring(30);
  const miniIn = useSpring(66, { damping: 20, stiffness: 120 });
  const miniW = Math.round(W * (tall ? 0.46 : 0.44));
  return (
    <Split
      text={<TextBlock kicker={COPY.screen.kicker} title={COPY.screen.title} sub={COPY.screen.sub} />}
      visual={
        <div style={{ width: W, display: "flex", flexDirection: "column", gap: 26 }}>
          <div
            style={{
              position: "relative",
              width: W,
              height: H,
              borderRadius: 26,
              overflow: "hidden",
              border: "1px solid var(--gr-line-strong)",
              boxShadow: "0 40px 90px -30px rgb(0 0 0 / 0.85)",
              opacity: panelIn,
              transform: `translateY(${(1 - panelIn) * 36}px)`,
              background: "var(--gr-video)",
            }}
          >
            <GameScreen width={W} height={H} />

            {/* Плашка «Эфир» + кто показывает: как на сцене продукта */}
            <div
              style={{
                position: "absolute",
                left: 22,
                top: 22,
                display: "flex",
                alignItems: "center",
                gap: 12,
                opacity: badgeIn,
                transform: `translateY(${(1 - badgeIn) * -12}px)`,
              }}
            >
              <span
                style={{
                  padding: "10px 20px",
                  borderRadius: 999,
                  background: "var(--gr-signal)",
                  color: "var(--gr-on-signal)",
                  fontFamily: "var(--gr-font-body)",
                  fontWeight: 500,
                  fontSize: 24,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                }}
              >
                {COPY.screen.badge}
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "6px 20px 6px 6px",
                  borderRadius: 999,
                  background: "rgb(5 6 8 / 0.72)",
                  color: "#fff",
                  fontFamily: "var(--gr-font-body)",
                  fontWeight: 500,
                  fontSize: 26,
                }}
              >
                <Avatar
                  name={SHARED.people[0].name}
                  color={SHARED.people[0].color}
                  size={38}
                  cutout="rgb(5 6 8)"
                />
                {SHARED.people[0].name}
              </span>
            </div>

            {/* Качество показа: плашка снизу справа */}
            <div
              style={{
                position: "absolute",
                right: 22,
                bottom: 22,
                opacity: qualityIn,
                transform: `translateY(${(1 - qualityIn) * 16}px)`,
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 22px",
                borderRadius: 999,
                background: "rgb(5 6 8 / 0.72)",
                color: "#fff",
                fontFamily: "var(--gr-font-code)",
                fontSize: 26,
              }}
            >
              <Icon name="screen-share" size={28} sw={2} />
              {COPY.screen.quality}
            </div>

            {/* Мини-комната поверх игры */}
            <div
              style={{
                position: "absolute",
                right: 22,
                top: 22,
                opacity: miniIn,
                transform: `translateY(${(1 - miniIn) * -30}px) scale(${0.94 + 0.06 * miniIn})`,
                transformOrigin: "right top",
              }}
            >
              <MiniRoom width={miniW} speaker={frame > 110 ? 1 : 0} />
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <Chip icon="pip" tone="signal" size={tall ? 32 : 28} delay={72}>
              {COPY.screen.miniKicker}
            </Chip>
          </div>
        </div>
      }
    />
  );
}

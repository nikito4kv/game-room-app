import { useCurrentFrame } from "remotion";
import { COPY } from "../copy";
import { BrowserFrame } from "../components/Frames";
import { Split, TextBlock, useVisualBox } from "../components/Scene";
import { Chip } from "../components/Type";
import { prog, useFormat, useSpring } from "../fx";

/**
 * Доказательство: настоящий экран комнаты (скриншот макета /design/room с
 * открытым чатом и тостами) и три коротких факта.
 */
export function SceneProof() {
  const frame = useCurrentFrame();
  const { tall } = useFormat();
  const box = useVisualBox();
  const W = Math.min(box.w, tall ? 936 : 860);
  const inP = useSpring(6);
  const zoom = 1 + 0.035 * prog(frame, 10, 90);
  return (
    <Split
      text={
        <>
          <TextBlock kicker={COPY.proof.kicker} title={COPY.proof.title} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 8 }}>
            {COPY.proof.chips.map((c, i) => (
              <Chip key={c.text} icon={c.icon} size={tall ? 30 : 26} delay={34 + i * 8}>
                {c.text}
              </Chip>
            ))}
          </div>
        </>
      }
      visual={
        <div style={{ opacity: inP, transform: `translateY(${(1 - inP) * 36}px)` }}>
          <BrowserFrame
            shot="room-chat.png"
            width={W}
            imgStyle={{ transform: `scale(${zoom})`, transformOrigin: "50% 50%" }}
          />
        </div>
      }
    />
  );
}

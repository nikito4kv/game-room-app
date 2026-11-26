import type { ReactNode } from "react";
import { AbsoluteFill } from "remotion";
import { Backdrop, Scene, timeline } from "../components/Scene";
import { SceneCta } from "../scenes/Cta";
import { SceneHook } from "../scenes/Hook";
import { SceneHost } from "../scenes/Host";
import { SceneInvite } from "../scenes/Invite";
import { SceneNoise } from "../scenes/Noise";
import { ScenePain } from "../scenes/Pain";
import { SceneProof } from "../scenes/Proof";
import { SceneScreen } from "../scenes/Screen";
import { SceneVoice } from "../scenes/Voice";

export const FPS = 30;
/** Перекрытие соседних сцен, кадров (кроссфейд). */
export const OVERLAP = 9;

export type PromoProps = { url: string };

type Plan = { id: string; dur: number; el: (p: PromoProps) => ReactNode }[];

/**
 * Раскадровка горизонтального ролика 16:9 (30 fps).
 * Порядок: крючок → боль → ссылка → голос → показ экрана → шумодав → права хоста → доказательство → призыв.
 * Чтобы удлинить сцену, меняйте её dur (кадры); всё остальное сдвинется само.
 */
export const PLAN_WIDE: Plan = [
  { id: "hook", dur: 90, el: () => <SceneHook /> },
  { id: "pain", dur: 108, el: () => <ScenePain /> },
  { id: "invite", dur: 124, el: () => <SceneInvite /> },
  { id: "voice", dur: 114, el: () => <SceneVoice /> },
  { id: "screen", dur: 126, el: () => <SceneScreen /> },
  { id: "noise", dur: 90, el: () => <SceneNoise /> },
  { id: "host", dur: 96, el: () => <SceneHost /> },
  { id: "proof", dur: 90, el: () => <SceneProof /> },
  { id: "cta", dur: 100, el: (p) => <SceneCta url={p.url} /> },
];

/** Раскадровка вертикального ролика 9:16 (без «доказательства»: короче и плотнее). */
export const PLAN_TALL: Plan = [
  { id: "hook", dur: 84, el: () => <SceneHook /> },
  { id: "pain", dur: 96, el: () => <ScenePain /> },
  { id: "invite", dur: 114, el: () => <SceneInvite /> },
  { id: "voice", dur: 114, el: () => <SceneVoice /> },
  { id: "screen", dur: 126, el: () => <SceneScreen /> },
  { id: "noise", dur: 84, el: () => <SceneNoise /> },
  { id: "host", dur: 90, el: () => <SceneHost /> },
  { id: "cta", dur: 100, el: (p) => <SceneCta url={p.url} /> },
];

export const framesOf = (plan: Plan) =>
  timeline(
    plan.map((s) => s.dur),
    OVERLAP,
  ).total;

function PromoBase({ plan, props }: { plan: Plan; props: PromoProps }) {
  const { items } = timeline(
    plan.map((s) => s.dur),
    OVERLAP,
  );
  return (
    <AbsoluteFill style={{ background: "var(--gr-canvas)", fontFamily: "var(--gr-font-body)" }}>
      <Backdrop />
      {plan.map((s, i) => (
        <Scene
          key={s.id}
          from={items[i].from}
          dur={items[i].dur}
          fade={OVERLAP}
          first={i === 0}
          last={i === plan.length - 1}
        >
          {s.el(props)}
        </Scene>
      ))}
    </AbsoluteFill>
  );
}

export const Promo16x9 = (props: PromoProps) => <PromoBase plan={PLAN_WIDE} props={props} />;
export const Promo9x16 = (props: PromoProps) => <PromoBase plan={PLAN_TALL} props={props} />;

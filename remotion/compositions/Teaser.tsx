import { AbsoluteFill } from "remotion";
import { Backdrop, Scene, timeline } from "../components/Scene";
import { SceneCta } from "../scenes/Cta";
import { SceneHook } from "../scenes/Hook";
import { OVERLAP, type PromoProps } from "./Promo";

/**
 * Тизер 9:16, 9 секунд: один крючок. Друзья по одной ссылке садятся за стол,
 * у говорящего загорается кольцо, в конце — адрес. Сцены те же, что в большом ролике.
 */
const DURS = [192, 87];
export const TEASER_FRAMES = timeline(DURS, OVERLAP).total;

export const Teaser9x16 = ({ url }: PromoProps) => {
  const { items } = timeline(DURS, OVERLAP);
  return (
    <AbsoluteFill style={{ background: "var(--gr-canvas)", fontFamily: "var(--gr-font-body)" }}>
      <Backdrop />
      <Scene from={items[0].from} dur={items[0].dur} fade={OVERLAP} first>
        <SceneHook />
      </Scene>
      <Scene from={items[1].from} dur={items[1].dur} fade={OVERLAP} last>
        <SceneCta url={url} />
      </Scene>
    </AbsoluteFill>
  );
};

import React from "react";
import { Composition } from "remotion";

// Токены дизайн-системы «Эфир» — единственный источник правды по цветам, радиусам
// и шрифтовым переменным. Видео использует те же var(--gr-*), что и интерфейс.
import "../design-system/tokens.css";
// Побочный эффект: регистрирует Unbounded и Onest и блокирует рендер до их загрузки.
import "./fonts";

import { SHARED } from "./copy";
import { FPS, Promo16x9, Promo9x16, PLAN_TALL, PLAN_WIDE, framesOf } from "./compositions/Promo";
import { Poster, Square } from "./compositions/Stills";
import { TEASER_FRAMES, Teaser9x16 } from "./compositions/Teaser";

// Единственный пропс — адрес в финале и на постерах. Менять можно в студии (панель
// справа) или флагом: npx remotion render ... --props='{"url":"game-room.space"}'
const defaultProps = { url: SHARED.url };

export const RemotionRoot: React.FC = () => (
  <>
    {/* Рекламный ролик 16:9 — сайт, YouTube, презентации */}
    <Composition
      id="Promo16x9"
      component={Promo16x9}
      durationInFrames={framesOf(PLAN_WIDE)}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={defaultProps}
    />
    {/* Вертикальный ролик 9:16 — Reels, Shorts, TikTok, Telegram */}
    <Composition
      id="Promo9x16"
      component={Promo9x16}
      durationInFrames={framesOf(PLAN_TALL)}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={defaultProps}
    />
    {/* Тизер 9:16, 9 секунд: один крючок */}
    <Composition
      id="Teaser9x16"
      component={Teaser9x16}
      durationInFrames={TEASER_FRAMES}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={defaultProps}
    />
    {/* Картинки для постов */}
    {/* Не Still: у Still fps=1, и пружины анимаций считаются неверно. Это композиция из одного кадра. */}
    <Composition
      id="Poster"
      component={Poster}
      durationInFrames={1}
      fps={FPS}
      width={1200}
      height={630}
      defaultProps={defaultProps}
    />
    <Composition
      id="Square"
      component={Square}
      durationInFrames={1}
      fps={FPS}
      width={1080}
      height={1080}
      defaultProps={defaultProps}
    />
  </>
);

import { Config } from "@remotion/cli/config";

// Точка входа — чтобы команды не требовали пути:
//   npx remotion studio   вместо   npx remotion studio remotion/index.ts
Config.setEntryPoint("./remotion/index.ts");

// Промежуточные кадры — PNG: без сжатия, на тёмных градиентах нет полос, а в итоговом MP4
// получается обычный yuv420p (с JPEG-кадрами Remotion даёт yuvj420p с «полным» диапазоном,
// из-за чего цвета в некоторых плеерах и соцсетях уезжают). Рендер от этого дольше на секунды.
Config.setVideoImageFormat("png");

// Перезаписывать готовый файл без вопроса — удобно для повторных рендеров.
Config.setOverwriteOutput(true);

// Запас по таймауту кадра (по умолчанию 30 с): картинки 2880×1800 и шрифты на
// медленном диске грузятся дольше. Вместе с retries в remotion/fonts.ts рендер не падает.
Config.setDelayRenderTimeoutInMilliseconds(90000);

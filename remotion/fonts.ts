import { cancelRender, continueRender, delayRender, staticFile } from "remotion";

/**
 * Шрифты бренда «Эфир»: Unbounded (заголовки) и Onest (текст). Файлы лежат
 * копией в public/promo/fonts (оригиналы — assets/*.ttf, лицензия OFL).
 *
 * next/font в Remotion не работает (это не Next-бандл), поэтому шрифты грузятся
 * вручную. Имена семейств совпадают с запасными именами в design-system/tokens.css
 * (`var(--font-unbounded), "Unbounded"`), поэтому переменные --gr-font-brand и
 * --gr-font-body в видео работают без правок токенов.
 *
 * Загрузка с retries: на длинном рендере в свежей вкладке Chrome загрузка шрифта
 * изредка подвисает. Ретраи перезапускают только проблемный кадр, а не весь рендер.
 * У Onest нет веса 600/700 — просим только 400 и 500, чтобы браузер не рисовал
 * «синтетический жирный».
 */
const FILES: { family: string; file: string; weight: string }[] = [
  { family: "Unbounded", file: "promo/fonts/Unbounded-SemiBold.ttf", weight: "600" },
  { family: "Unbounded", file: "promo/fonts/Unbounded-Bold.ttf", weight: "700" },
  { family: "Onest", file: "promo/fonts/Onest-Regular.ttf", weight: "400" },
  { family: "Onest", file: "promo/fonts/Onest-Medium.ttf", weight: "500" },
];

const loadOne = async ({ family, file, weight }: (typeof FILES)[number]) => {
  const face = new FontFace(family, `url(${staticFile(file)}) format('truetype')`, { weight });
  await face.load();
  document.fonts.add(face);
};

// Блокирует рендер, пока шрифты не готовы: первые кадры не уедут на системный шрифт.
const handle = delayRender("Загрузка шрифтов Unbounded и Onest", { retries: 3 });

export const fontsReady = Promise.all(FILES.map(loadOne))
  .then(() => {
    continueRender(handle);
  })
  .catch((err: Error) => {
    cancelRender(err);
  });

// В приложении переменные --font-unbounded и --font-onest выставляет next/font. Здесь
// next/font нет, поэтому задаём их сами: без них --gr-font-brand и --gr-font-body из
// tokens.css становятся недействительными и текст рисуется системным шрифтом с засечками.
document.documentElement.style.setProperty("--font-unbounded", '"Unbounded"');
document.documentElement.style.setProperty("--font-onest", '"Onest"');

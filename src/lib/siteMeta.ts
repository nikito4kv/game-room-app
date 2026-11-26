// Общие строки метаданных сайта. Next не сливает вложенные объекты метаданных:
// openGraph дочерней страницы заменяет корневой целиком. Поэтому базу (имя
// сайта, язык) страницы подмешивают сами: { ...SITE_OPEN_GRAPH, title, … }.

export const SITE_NAME = "Game Room";

/** Обещание сайта одной фразой: лендинг, meta description, превью ссылок. */
export const SITE_DESCRIPTION =
  "Голосовая комната для своей компании: чат и показ экрана. Без регистрации, прямо в браузере.";

export const SITE_OPEN_GRAPH = {
  type: "website",
  siteName: SITE_NAME,
  locale: "ru_RU",
} as const;

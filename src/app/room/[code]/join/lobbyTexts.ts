// Тексты лобби, которые зависят от данных: подсказка у пароля и что делать с
// микрофоном. Чистые функции — под тестами.
import type { MicErrorKind } from "@/lib/audio/micErrors";

/**
 * С какого остатка попыток пароля называть число. «Осталось попыток: 19» другу,
 * который ошибся буквой, ни к чему и только пугает; важно, когда их мало.
 */
export const ATTEMPTS_SHOWN_FROM = 5;

/**
 * Подсказка у поля пароля после неверного пароля. Остаток — только когда он
 * мал (текст с числом — от сервера); иначе просто «Неверный пароль».
 */
export function wrongPasswordText(attemptsLeft: number | null | undefined, serverMessage: string): string {
  if (attemptsLeft === null || attemptsLeft === undefined || attemptsLeft > ATTEMPTS_SHOWN_FROM) {
    return "Неверный пароль";
  }
  return serverMessage;
}

/** Что сделать с микрофоном в лобби. Без «вас не слышно»: в комнату ещё не вошли, а войти можно и так. */
export function lobbyMicHint(kind: MicErrorKind): string {
  const anyway = "Войти и слушать можно и так.";
  switch (kind) {
    case "denied":
      return `Разрешите доступ: нажмите на значок слева от адреса сайта, включите «Микрофон» и нажмите «Повторить». ${anyway}`;
    case "not-found":
      return `Подключите микрофон или гарнитуру и нажмите «Повторить». ${anyway}`;
    case "busy":
      return `Его держит другая программа или вкладка. Закройте её и нажмите «Повторить» или выберите другой микрофон. ${anyway}`;
    case "constraints":
    case "unknown":
      return `Нажмите «Повторить» или выберите другой микрофон. ${anyway}`;
  }
}

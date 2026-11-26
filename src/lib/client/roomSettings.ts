// Настройки комнаты у хоста применяются сразу (каждый переключатель — свой запрос),
// поэтому здесь осталась только проверка пароля перед кнопкой «Задать».
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/api/contract";

/** Почему пароль не годится; null — годится или поле пустое. */
export function passwordProblem(raw: string): string | null {
  const pw = raw.trim();
  if (!pw) return null;
  if (pw.length < PASSWORD_MIN_LENGTH) return `Нужно хотя бы ${PASSWORD_MIN_LENGTH} символа`;
  if (pw.length > PASSWORD_MAX_LENGTH) return `Не длиннее ${PASSWORD_MAX_LENGTH} символов`;
  return null;
}

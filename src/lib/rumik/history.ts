// История рисовалки: «назад» и «вперёд». Хранит снимки состояния ДО каждого
// действия (штрих, заливка, «стереть всё», загрузка файла). Снимок холста
// 572×480 — около 1,1 МБ, поэтому шагов не больше HISTORY_LIMIT (≈ 22 МБ).
// Чистая логика без холста: тип снимка задаёт тот, кто пользуется.

/** Сколько шагов назад помним. */
export const HISTORY_LIMIT = 20;

export class History<T> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(private readonly limit: number = HISTORY_LIMIT) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Перед действием: запомнить, как было. Новое действие стирает «вперёд». */
  record(before: T): void {
    this.past.push(before);
    if (this.past.length > this.limit) this.past.splice(0, this.past.length - this.limit);
    this.future.length = 0;
  }

  /** Что вернёт undo, не трогая историю. */
  peekUndo(): T | undefined {
    return this.past.at(-1);
  }

  /** Что вернёт redo, не трогая историю. */
  peekRedo(): T | undefined {
    return this.future.at(-1);
  }

  /** Шаг назад: вернуть прежнее состояние (текущее уходит во «вперёд»). */
  undo(current: T): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(current);
    return prev;
  }

  /** Шаг вперёд после отмены. */
  redo(current: T): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(current);
    return next;
  }

  /** Забыть всё (например, рисунок сменили в другой вкладке). */
  clear(): void {
    this.past.length = 0;
    this.future.length = 0;
  }
}

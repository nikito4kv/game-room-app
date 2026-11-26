// Склейка классов без зависимостей (clsx/tailwind-merge в проект не тащим).
// Конфликты утилит не разрешает: `className` снаружи примитива — для отступов,
// позиции и ширины, а не для перекраски (цвет задают варианты компонента).
export type ClassValue = string | false | null | undefined | 0;

export function cn(...parts: ClassValue[]): string {
  return parts.filter(Boolean).join(" ");
}

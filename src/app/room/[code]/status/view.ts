// Как выглядит статус участника: значок у ника, кнопка в поповере и слова для
// подписи места. Чистые данные и функции (без React).
import type { GlyphSpec } from "@/components/ui/Glyph";
import type { ManualStatus, PublicStatus } from "@/lib/api/contract";

export const STATUS_VIEW: Readonly<Record<ManualStatus, { glyph: GlyphSpec; button: string; words: string }>> = {
  game: { glyph: { icon: "gamepad", tone: "text-signal-ink" }, button: "В игре", words: "в игре" },
  afk: { glyph: { icon: "moon", tone: "text-caution-ink" }, button: "Отошёл", words: "отошёл" },
  listen: { glyph: { icon: "headphones", tone: "text-ink-2" }, button: "Слушаю", words: "слушает" },
};

/** Статус словами для подписи места и панели: «в игре: CS2», «отошёл»; без статуса — null. */
export function statusWords(s: PublicStatus): string | null {
  if (!s.kind) return null;
  const words = STATUS_VIEW[s.kind].words;
  return s.text ? `${words}: ${s.text}` : words;
}

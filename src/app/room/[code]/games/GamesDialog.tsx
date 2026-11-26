"use client";

import { Dialog, Glyph, cn } from "@/components/ui";
import { GAME_BUTTONS } from "./view";
import { useSendGame } from "./useSendGame";

/**
 * «Игры» из меню комнаты (флаг games): три крупные кнопки с пояснением — кубик,
 * «Кто платит?», «Все готовы?». Итог приходит всем тостом и значком над местом
 * (useGameFeed); окно после нажатия закрывается, чтобы не закрывать стол.
 */
export function GamesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const send = useSendGame();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title="Игры для всех"
      description="Итог увидят все, кто сейчас в комнате."
      data-testid="games-dialog"
    >
      <div className="flex flex-col gap-2">
        {GAME_BUTTONS.map((g) => (
          <button
            key={g.action}
            type="button"
            data-testid={`game-${g.action}`}
            onClick={() => {
              send({ action: g.action });
              onOpenChange(false);
            }}
            className={cn(
              "flex items-center gap-3 rounded-card border border-line bg-wash-1 p-3 text-left",
              "transition-colors duration-140 hover:bg-wash-2 active:bg-wash-3",
            )}
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-wash-2">
              <Glyph spec={g.glyph} size={22} />
            </span>
            <span className="min-w-0">
              <span className="block text-body font-semibold text-ink">{g.title}</span>
              <span className="block text-label text-ink-2">{g.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}

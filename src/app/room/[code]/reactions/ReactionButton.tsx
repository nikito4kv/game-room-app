"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { Glyph, IconButton, Popover, type GlyphSpec } from "@/components/ui";
import { nextIndex, rovingKey } from "@/components/ui/roving";
import { REACTION_KINDS } from "@/lib/api/contract";
import { useRoomConfig } from "../state/useRoomConfig";
import { REACTION_VIEW } from "./gesture";
import { useSendReaction } from "./useSendReaction";

export type ToolbarItem = {
  key: string;
  glyph: GlyphSpec;
  label: string;
  /** Переключатель (статус): нажат — заливка, aria-pressed. */
  pressed?: boolean;
  onClick: () => void;
};

/**
 * Кнопка «Реакции» в доке: поповер с 👍 🔥 😂 GG над кнопкой (значки из набора
 * «Эфира», не эмодзи ОС). Нажали — реакция сразу всплывает над своим местом и
 * уходит всем. Поповер после нажатия не закрывается: короткую очередь удобно
 * жать подряд; закрывают Esc, клик мимо или та же кнопка (фокус возвращается на
 * неё). Реакции — панель инструментов: стрелки и Home/End, Tab уводит из
 * поповера (§2, принцип 6). Звуки, игры и статус — отдельно: свои кнопки и меню
 * комнаты, чтобы всё не лежало в одной куче.
 */
export default function ReactionButton() {
  const { flags } = useRoomConfig();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const send = useSendReaction();
  if (!flags.reactions) return null;

  const items: ToolbarItem[] = REACTION_KINDS.map((kind) => ({
    key: kind,
    glyph: REACTION_VIEW[kind].glyph,
    label: REACTION_VIEW[kind].label,
    onClick: () => send(kind),
  }));

  return (
    <>
      <IconButton
        ref={ref}
        data-testid="dock-reactions"
        icon="smile-plus"
        label="Реакции"
        hint={open ? "Закрыть реакции" : "Реакции"}
        variant={open ? "inverse" : "soft"}
        size="lg"
        shape="round"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      />
      <Popover
        open={open}
        onOpenChange={setOpen}
        anchor={ref}
        triggerRef={ref}
        side="top"
        align="center"
        aria-label="Реакции"
        data-testid="reactions-popover"
      >
        {/* display — на обёртке: у корня поповера его задаёт браузер (закрыт — none). */}
        <GlyphToolbar label="Отправить реакцию" items={items} testid="reaction" />
      </Popover>
    </>
  );
}

/**
 * Ряд кнопок-значков с roving tabindex: в порядке Tab стоит одна (последняя
 * тронутая), к остальным — стрелками и Home/End. Его же показывает витрина.
 */
export function GlyphToolbar({ label, items, testid }: { label: string; items: ToolbarItem[]; testid: string }) {
  const [current, setCurrent] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const none = items.map(() => false);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const move = rovingKey(e.key, "horizontal");
    if (!move) return;
    e.preventDefault();
    const from = refs.current.findIndex((el) => el === document.activeElement);
    const next = nextIndex(from < 0 ? current : from, move, none);
    setCurrent(next);
    refs.current[next]?.focus();
  }

  return (
    <div role="toolbar" aria-label={label} onKeyDown={onKeyDown} className="flex gap-1">
      {items.map((item, i) => (
        <IconButton
          key={item.key}
          ref={(el) => {
            refs.current[i] = el;
          }}
          data-testid={`${testid}-${item.key}`}
          tabIndex={i === current ? 0 : -1}
          onFocus={() => setCurrent(i)}
          icon={<Glyph spec={item.glyph} size={22} />}
          label={item.label}
          pressed={item.pressed}
          variant={item.pressed ? "inverse" : "ghost"}
          size="lg"
          shape="round"
          onClick={item.onClick}
        />
      ))}
    </div>
  );
}

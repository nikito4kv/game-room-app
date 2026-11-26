"use client";

import { useState } from "react";
import { TextField } from "@/components/ui";
import { MANUAL_STATUSES, STATUS_TEXT_MAX, cleanStatusText } from "@/lib/api/contract";
import { GlyphToolbar, type ToolbarItem } from "../reactions/ReactionButton";
import { useMyStatus } from "./useStatus";
import { STATUS_VIEW } from "./view";

/**
 * «Мой статус» в поповере дока: 🕹️ В игре · 💤 Отошёл · 🎧 Слушаю — переключатели
 * (нажатый ещё раз снимает статус). У «В игре» — поле «Во что играете?»: его видят
 * все у вашего ника. Уходит на сервер с паузой (StatusProvider).
 */
export function StatusPicker() {
  const { status, setStatus } = useMyStatus();
  // Сырой ввод: пробел в конце не съедаем, пока человек печатает.
  const [draft, setDraft] = useState(status.text);
  const items: ToolbarItem[] = MANUAL_STATUSES.map((kind) => ({
    key: kind,
    glyph: STATUS_VIEW[kind].glyph,
    label: STATUS_VIEW[kind].button,
    pressed: status.kind === kind,
    onClick: () =>
      setStatus(
        status.kind === kind ? { kind: null, text: "" } : { kind, text: kind === "game" ? cleanStatusText(draft) : "" },
      ),
  }));
  return (
    <div className="flex flex-col gap-1.5">
      <GlyphToolbar label="Мой статус" items={items} testid="status" />
      {status.kind === "game" && (
        <TextField
          aria-label="Во что играете"
          placeholder="Во что играете?"
          value={draft}
          maxLength={STATUS_TEXT_MAX}
          data-testid="status-text"
          wrapperClassName="px-1"
          onChange={(e) => {
            setDraft(e.target.value);
            setStatus({ kind: "game", text: cleanStatusText(e.target.value) });
          }}
        />
      )}
    </div>
  );
}

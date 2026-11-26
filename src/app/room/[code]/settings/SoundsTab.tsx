"use client";

import { useId, useRef, useState } from "react";
import { Button, Select, SettingRow, Slider, Switch } from "@/components/ui";
import { isSoundId, type SoundId } from "@/lib/api/contract";
import {
  getBoardEnabled,
  getBoardVolume,
  getEnterSound,
  getSfxEnabled,
  getSfxVolume,
  setEnterSound,
} from "@/lib/clientStorage";
import { playSfx, playTestSound, setSfxEnabled, setSfxVolume } from "@/lib/audio/sfx";
import { playBoardSound, setBoardEnabled, setBoardVolume } from "@/lib/audio/soundboard";
import { useSoundCatalog } from "../sounds/catalog";
import { useRoomConfig } from "../state/useRoomConfig";
import Section from "./Section";

/** Не чаще этого играем пример звука, пока тянут ползунок громкости. */
const PREVIEW_MS = 180;
/** Пример звука соундборда длиннее писка — пока тянут ползунок, реже. */
const BOARD_PREVIEW_MS = 700;
/** Владелец пробных звуков: новая проба обрывает прежнюю, чужие звуки не трогает. */
const PREVIEW_OWNER = "preview";


/**
 * Вкладка «Звуки»: звуки событий (вход и выход друзей, сообщения, микрофон) и их
 * громкость; с флагом soundboard — ещё соундборд: слышать ли звуки других, их
 * громкость и свой звук входа. Источник правды — localStorage, сеттеры sfx и
 * soundboard сразу и сохраняют, и обновляют звучащую копию.
 */
export default function SoundsTab() {
  const { flags } = useRoomConfig();
  return (
    <div className="flex flex-col gap-6">
      <EventSounds />
      {flags.soundboard && <BoardSounds />}
    </div>
  );
}

function EventSounds() {
  const [on, setOn] = useState(getSfxEnabled);
  const [volume, setVolume] = useState(getSfxVolume);
  const switchId = useId();
  const lastPreview = useRef(0);

  return (
    <Section title="Звуки интерфейса">
      <div className="divide-y divide-line rounded-card border border-line px-4">
        <SettingRow
          htmlFor={switchId}
          title="Звуки событий"
          description="Вход и выход друзей, сообщения, микрофон, связь"
          control={
            <Switch
              id={switchId}
              checked={on}
              onCheckedChange={(next) => {
                setOn(next);
                setSfxEnabled(next);
                if (next) playSfx("mic-on", { urgent: true });
              }}
            />
          }
        />
        <div className="py-3">
          <Slider
            label="Громкость звуков"
            value={Math.round(volume * 100)}
            disabled={!on}
            onValueChange={(v) => {
              const vol = v / 100;
              setVolume(vol);
              setSfxVolume(vol);
              const now = performance.now();
              if (now - lastPreview.current > PREVIEW_MS) {
                lastPreview.current = now;
                playSfx("mic-on", { urgent: true });
              }
            }}
            formatValue={(v) => `${v}%`}
          />
        </div>
      </div>
      <Button variant="secondary" size="sm" icon="bell" className="self-start" disabled={!on} onClick={playTestSound}>
        Проверить звук
      </Button>
    </Section>
  );
}

/**
 * Соундборд у себя. Выключатель глушит только чужие звуки (свои вы и так
 * слышите — сами нажимаете). Звук входа уходит на сервер с входом в комнату,
 * поэтому новый выбор другие услышат со следующего входа.
 */
function BoardSounds() {
  const [on, setOn] = useState(getBoardEnabled);
  const [volume, setVolume] = useState(getBoardVolume);
  const [enter, setEnter] = useState<SoundId | null>(() => {
    const raw = getEnterSound();
    return isSoundId(raw) ? raw : null;
  });
  const switchId = useId();
  const lastPreview = useRef(0);
  const catalog = useSoundCatalog();
  // Звук входа выбирают из готового набора: свои звуки комнаты у других комнат не играют.
  const enterOptions = [
    { value: "", label: "Обычный" },
    ...catalog.filter((s) => s.source !== "room").map((s) => ({ value: s.id, label: s.name })),
  ];

  return (
    <Section title="Соундборд">
      <div className="divide-y divide-line rounded-card border border-line px-4">
        <SettingRow
          htmlFor={switchId}
          title="Звуки других"
          description="Ба-дум-тсс, та-дам и другие звуки, которые включают люди в комнате"
          control={
            <Switch
              id={switchId}
              checked={on}
              onCheckedChange={(next) => {
                setOn(next);
                setBoardEnabled(next);
              }}
            />
          }
        />
        <div className="py-3">
          <Slider
            label="Громкость звуков других"
            value={Math.round(volume * 100)}
            disabled={!on}
            onValueChange={(v) => {
              const vol = v / 100;
              setVolume(vol);
              setBoardVolume(vol);
              const now = performance.now();
              if (now - lastPreview.current > BOARD_PREVIEW_MS) {
                lastPreview.current = now;
                playBoardSound("correct", PREVIEW_OWNER, { preview: true });
              }
            }}
            formatValue={(v) => `${v}%`}
          />
        </div>
      </div>
      <Select
        label="Мой звук входа"
        icon="volume"
        value={enter ?? ""}
        options={enterOptions}
        hint="Его услышат все, когда вы войдёте в комнату. Новый звук — со следующего входа"
        onChange={(e) => {
          const next = isSoundId(e.target.value) ? e.target.value : null;
          setEnter(next);
          setEnterSound(next);
          if (next) playBoardSound(next, PREVIEW_OWNER, { preview: true });
        }}
      />
    </Section>
  );
}

"use client";

import { useId } from "react";
import { Button, ChoiceGroup, InlineAlert, SettingRow, Switch, type Choice } from "@/components/ui";
import { clampScreenQuality, isQualityAllowed } from "@/lib/client/screenCap";
import { SCREEN_PRESETS, type ScreenQuality } from "@/lib/screenShare";
import { useScreenShareControl } from "../stage/useScreenShareControl";
import { screenDuckPref, screenQualityPref } from "../state/prefs";
import { useRoomConfig } from "../state/useRoomConfig";
import { usePersistentState } from "../state/usePersistentState";
import Section from "./Section";

const QUALITIES = Object.keys(SCREEN_PRESETS) as ScreenQuality[];

/**
 * Вкладка «Экран»: профиль качества показа и (флаг screen_ducking) приглушение
 * звука чужого показа, пока говорят. Во время показа новый профиль
 * применяется на лету (useScreenShareControl); что даст перезапуск, если на лету
 * раскрылось не всё, — готовым текстом restartHint.
 */
export default function ScreenTab() {
  const [chosen, setQuality] = usePersistentState(screenQualityPref);
  const [duck, setDuck] = usePersistentState(screenDuckPref);
  const duckId = useId();
  const screen = useScreenShareControl();
  // Потолок качества от администрации (А3): профили выше него недоступны.
  const { maxScreenQuality: cap, flags } = useRoomConfig();
  const quality = clampScreenQuality(chosen, cap);
  const capped = QUALITIES.some((q) => !isQualityAllowed(q, cap));
  const options: Choice<ScreenQuality>[] = QUALITIES.map((q) => {
    const allowed = isQualityAllowed(q, cap);
    return {
      value: q,
      title: SCREEN_PRESETS[q].title,
      meta: SCREEN_PRESETS[q].meta,
      description: allowed ? SCREEN_PRESETS[q].description : `Ограничено сервером: сейчас доступно до ${cap}.`,
      disabled: !allowed,
    };
  });
  return (
    <div className="flex flex-col gap-6">
      <Section title="Качество показа">
        <ChoiceGroup label="Качество показа" value={quality} onValueChange={setQuality} options={options} />
        {capped && (
          <p className="text-label text-ink-3" data-testid="screen-cap-hint">
            Качество выше {cap} сейчас ограничено сервером, чтобы связь оставалась стабильной у всех.
          </p>
        )}
        {screen.enabled && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button
              variant="secondary"
              size="sm"
              icon="refresh"
              loading={screen.pending}
              onClick={() => screen.restart()}
            >
              Перезапустить показ
            </Button>
            <p className={screen.restartAdvised ? "text-label text-caution-ink" : "text-label text-ink-3"}>
              {screen.restartAdvised
                ? (screen.restartHint ?? "Часть нового качества включится после перезапуска")
                : "Новое качество уже работает. Перезапуск — чтобы выбрать другое окно"}
            </p>
          </div>
        )}
        <InlineAlert tone="info" title="Как показать игру со звуком">
          Запустите игру в окне без рамки, выберите «Весь экран» и отметьте «Поделиться системным звуком».
        </InlineAlert>
      </Section>
      {flags.screen_ducking && (
        <Section title="Звук чужого показа">
          <div className="rounded-card border border-line px-4">
            <SettingRow
              htmlFor={duckId}
              title="Приглушать, пока говорят"
              description="Кто-то заговорил — звук показа тише, замолчали — громкость возвращается"
              control={<Switch id={duckId} checked={duck} onCheckedChange={setDuck} />}
            />
          </div>
        </Section>
      )}
    </div>
  );
}

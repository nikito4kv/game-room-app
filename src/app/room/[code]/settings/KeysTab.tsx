"use client";

import { useEffect, useId, useState } from "react";
import { Button, InlineAlert, Kbd, SegmentedControl, SettingRow, Slider, Switch, cn } from "@/components/ui";
import { DEFAULT_KEYBINDS, type KeyAction, type Keybinds } from "@/lib/clientStorage";
import { ACTION_LABELS, formatKeyCode, reservedKeyReason } from "@/lib/keys";
import { PTT_RELEASE_RANGE, pttReleasePref } from "../audio/voicePrefs";
import { bindsPref, showKeysPref, voiceModePref } from "../state/prefs";
import { usePersistentState } from "../state/usePersistentState";
import Section from "./Section";

const ACTIONS: KeyAction[] = ["mic", "deafen", "screen", "chat", "ptt"];
// В режиме рации главная клавиша — «говорить», она и стоит первой.
const PTT_ORDER: KeyAction[] = ["ptt", "mic", "deafen", "screen", "chat"];
const OPEN_MIC_ORDER: KeyAction[] = ["mic", "deafen", "screen", "chat"];

/**
 * Название действия в списке клавиш. «Рация вкл/выкл» и «Рация (держать)»
 * путали (ревью): одна клавиша — говорить, пока держишь, другая выключает
 * микрофон целиком.
 */
const keyTitle = (a: KeyAction) => (a === "ptt" ? "Говорить в рацию" : ACTION_LABELS[a]);

/**
 * Вкладка «Клавиши»: режим голоса (открытый микрофон или рация), честное
 * предупреждение про фокус окна, переназначение клавиш, задержка отпускания рации.
 * На сенсорном экране сверху пометка, что горячие клавиши — для клавиатуры.
 */
export default function KeysTab() {
  const [mode, setMode] = usePersistentState(voiceModePref);
  const [showKeys, setShowKeys] = usePersistentState(showKeysPref);
  const [binds, setBinds] = usePersistentState(bindsPref);
  const [releaseMs, setReleaseMs] = usePersistentState(pttReleasePref);
  // Ждём клавишу — только для одного действия за раз.
  const [capturing, setCapturing] = useState<KeyAction | null>(null);
  const hintsId = useId();
  const ptt = mode === "ptt";
  const pttKey = formatKeyCode(binds.ptt);
  const keyHint = (a: KeyAction): string | undefined => {
    if (!ptt) return undefined;
    if (a === "ptt") return "Держите, пока говорите";
    if (a === "mic") return `Выключенный микрофон молчит, даже если держать ${pttKey}`;
    return undefined;
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Решение 3: вкладка остаётся и на телефоне, но честно говорит, для чего она. */}
      <div className="hidden pointer-coarse:block">
        <InlineAlert tone="info" title="Горячие клавиши работают с клавиатуры">
          На телефоне и планшете — кнопки внизу экрана. В режиме рации держите кнопку микрофона, пока
          говорите.
        </InlineAlert>
      </div>
      <Section title="Режим голоса">
        <SegmentedControl
          label="Режим голоса"
          block
          value={mode}
          onValueChange={setMode}
          options={[
            { value: "toggle", label: "Открытый микрофон", icon: "mic" },
            { value: "ptt", label: "Рация", icon: "radio" },
          ]}
        />
        <p className="text-label text-ink-2">
          {ptt
            ? `Вас слышно, пока держите ${pttKey}. Клавиша ${formatKeyCode(binds.mic)} выключает и включает микрофон целиком.`
            : "Вас слышно, когда вы говорите громче порога (Голос → Чувствительность)."}
        </p>
        {ptt && (
          <Slider
            label="Задержка отпускания"
            value={releaseMs}
            onValueChange={setReleaseMs}
            min={PTT_RELEASE_RANGE.min}
            max={PTT_RELEASE_RANGE.max}
            step={PTT_RELEASE_RANGE.step}
            marks={[PTT_RELEASE_RANGE.initial]}
            snap={20}
            formatValue={(v) => (v === 0 ? "нет" : `${v} мс`)}
          />
        )}
        {/* Про фокус окна — для компьютера; на сенсорном экране всё сказано сверху. */}
        <div className="pointer-coarse:hidden">
          <InlineAlert tone="caution" title="Клавиши работают, только когда окно комнаты активно">
            В игре браузер их не слышит. Во время игры включайте открытый микрофон с порогом «Авто»: он
            сам отсекает тишину и соседей. Кнопка выключения микрофона на гарнитуре работает всегда.
          </InlineAlert>
        </div>
      </Section>

      <Section title="Клавиши">
        <div className="divide-y divide-line rounded-card border border-line px-4">
          {(ptt ? PTT_ORDER : OPEN_MIC_ORDER).map((action) => (
            <BindRow
              key={action}
              action={action}
              title={keyTitle(action)}
              hint={keyHint(action)}
              binds={binds}
              labelOf={keyTitle}
              capturing={capturing === action}
              onCapture={(on) => setCapturing(on ? action : null)}
              onChange={setBinds}
            />
          ))}
          <SettingRow
            htmlFor={hintsId}
            title="Буквы клавиш на кнопках"
            description="Маленькая подсказка в углу кнопок дока"
            control={<Switch id={hintsId} checked={showKeys} onCheckedChange={setShowKeys} />}
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon="reset"
          className="self-start"
          onClick={() => {
            setCapturing(null);
            setBinds(DEFAULT_KEYBINDS);
          }}
        >
          Сбросить клавиши
        </Button>
      </Section>
    </div>
  );
}

/**
 * Строка клавиши: название действия + кнопка-клавиша. Клик — ждём новую клавишу
 * (перехват в фазе capture, раньше горячих клавиш комнаты); Esc — отмена;
 * занятая или служебная клавиша — пояснение, ждём дальше.
 */
function BindRow({
  action,
  title,
  hint,
  binds,
  labelOf,
  capturing,
  onCapture,
  onChange,
}: {
  action: KeyAction;
  title: string;
  /** Пояснение под названием, пока клавишу не меняют. */
  hint?: string;
  binds: Keybinds;
  labelOf: (a: KeyAction) => string;
  capturing: boolean;
  onCapture: (on: boolean) => void;
  onChange: (binds: Keybinds) => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") {
        setProblem(null);
        onCapture(false);
        return;
      }
      const reserved = reservedKeyReason(e.code);
      if (reserved) {
        setProblem(reserved);
        return;
      }
      const taken = ACTIONS.find((a) => a !== action && binds[a] === e.code);
      if (taken) {
        setProblem(`Уже занято: ${labelOf(taken)}`);
        return;
      }
      setProblem(null);
      onChange({ ...binds, [action]: e.code });
      onCapture(false);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [capturing, binds, action, labelOf, onCapture, onChange]);

  const key = formatKeyCode(binds[action]);
  return (
    <SettingRow
      title={title}
      description={
        capturing ? (
          <span className={problem ? "text-caution-ink" : "text-ink-2"} aria-live="polite">
            {problem ?? "Нажмите клавишу… Esc, чтобы отменить"}
          </span>
        ) : (
          hint
        )
      }
      control={
        <button
          type="button"
          aria-label={
            capturing
              ? `Ждём клавишу для «${title}». Esc, чтобы отменить`
              : `Клавиша для «${title}»: ${key}. Нажмите, чтобы изменить`
          }
          aria-pressed={capturing}
          onClick={() => {
            setProblem(null);
            onCapture(!capturing);
          }}
          className={cn(
            "rounded-key transition-transform duration-140 hover:scale-105 motion-reduce:hover:scale-100",
            capturing && "outline-2 outline-offset-2 outline-ink",
          )}
        >
          <Kbd>{capturing ? "…" : key}</Kbd>
        </button>
      }
    />
  );
}

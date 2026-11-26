"use client";

import { useId, useState } from "react";
import {
  Button,
  LevelMeter,
  SegmentedControl,
  Select,
  SettingRow,
  Slider,
  Switch,
  formatDb,
  type GateMode,
} from "@/components/ui";
import { isMicError } from "@/lib/audio/micErrors";
import { calibrationText, noiseSuppressionText, sensitivityText, type StatusText } from "@/lib/audio/voiceTexts";
import { SENSITIVITY_RANGE } from "@/lib/audio/worklet/protocol";
import { useDeviceChoice, type AudioDeviceOption } from "../audio/useAudioDevices";
import { useVoiceControls } from "../audio/useMic";
import { useVolumes } from "../state/volumes";
import Section from "./Section";
import { CALIBRATION_MS, useVoiceMonitor, type VoiceMonitor } from "./useVoiceMonitor";

/**
 * Вкладка «Голос»: микрофон, чувствительность (порог прямо на полосе уровня),
 * обработка и вывод звука. Всё меняется вживую, без переподключения.
 */
export default function VoiceTab() {
  const voice = useVoiceControls();
  const monitor = useVoiceMonitor(voice);
  return (
    <div className="flex flex-col gap-8">
      <MicrophoneSection />
      <SensitivitySection monitor={monitor} />
      <ProcessingSection monitor={monitor} />
      <OutputSection />
    </div>
  );
}

/** Выбранное устройство пропало — всё равно показываем его в списке, иначе <select> покажет чужое. */
function withSelected(options: AudioDeviceOption[], selected: string, missing: string): AudioDeviceOption[] {
  return options.some((o) => o.value === selected) ? options : [...options, { value: selected, label: missing }];
}

/** Текст пояснения в цвете своего тона (caution — янтарный, иначе — как обычная подпись). */
function Tone({ status }: { status: StatusText }) {
  return <span className={status.tone === "caution" ? "text-caution-ink" : undefined}>{status.text}</span>;
}

function MicrophoneSection() {
  const { settings, updateSettings, inputFallback } = useVoiceControls();
  const mic = useDeviceChoice("audioinput");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = (id: string) => {
    setPending(id);
    setError(null);
    mic
      .select(id)
      .catch((e: unknown) =>
        setError(isMicError(e) ? `${e.title}. Оставили прежний микрофон.` : "Не получилось переключить микрофон."),
      )
      .finally(() => setPending(null));
  };

  return (
    <Section title="Микрофон">
      <Select
        label="Устройство"
        icon="mic"
        value={pending ?? mic.selected}
        options={withSelected(mic.options, mic.selected, "Выбранный микрофон (не подключён)")}
        onChange={(e) => choose(e.target.value)}
        error={error ?? undefined}
        hint={inputFallback ? "Выбранный микрофон не подключён. Пока работает системный" : undefined}
      />
      <Slider
        label="Громкость микрофона"
        value={Math.round(settings.gain * 100)}
        onValueChange={(v) => updateSettings({ gain: v / 100 })}
        max={200}
        step={5}
        marks={[100]}
        snap={4}
        formatValue={(v) => `${v}%`}
      />
    </Section>
  );
}

type Calibration =
  | { phase: "idle" }
  | { phase: "running"; left: number }
  | { phase: "done"; text: StatusText };

const MODE_OPTIONS: { value: GateMode; label: string }[] = [
  { value: "auto", label: "Авто" },
  { value: "manual", label: "Вручную" },
  { value: "off", label: "Выкл" },
];

function SensitivitySection({ monitor }: { monitor: VoiceMonitor }) {
  const { settings, updateSettings } = useVoiceControls();
  const mode = settings.gateMode;
  const threshold = mode === "manual" ? settings.manualThresholdDb : monitor.autoThresholdDb;
  // Без обработки (не запустилась) порога нет — полоса показывает просто уровень.
  const meterMode: GateMode = mode === "auto" && !Number.isFinite(threshold) ? "off" : mode;
  const [cal, setCal] = useState<Calibration>({ phase: "idle" });
  const hintId = useId();

  const calibrate = async () => {
    const started = Date.now();
    const seconds = Math.round(CALIBRATION_MS / 1000);
    setCal({ phase: "running", left: seconds });
    // Отсчёт на кнопке — таймер только на время калибровки.
    const timer = setInterval(() => {
      const left = Math.max(1, Math.ceil((CALIBRATION_MS - (Date.now() - started)) / 1000));
      setCal((c) => (c.phase === "running" && c.left !== left ? { phase: "running", left } : c));
    }, 250);
    try {
      const r = await monitor.calibrate();
      // Во «Вручную» калибровка ставит порог на ползунок; в «Авто» порог опирается на неё сам.
      if (r.ok && mode === "manual") updateSettings({ manualThresholdDb: Math.round(r.thresholdDb) });
      setCal({ phase: "done", text: calibrationText(r) });
    } finally {
      clearInterval(timer);
    }
  };

  const caption =
    mode === "off"
      ? "Передаётся всё, что слышит микрофон."
      : mode === "manual"
        ? `Вас слышно, когда полоса заходит за отметку: ${formatDb(threshold)}.`
        : Number.isFinite(threshold)
          ? `Порог подбирается сам по вашему голосу: сейчас ${formatDb(threshold)}.`
          : "Порог подберётся сам, как только вы заговорите.";
  // Совет называет ползунок так же, как он подписан (ревью: «сдвиньте
  // чувствительность» указывало на «Подстройку порога»).
  const advice =
    mode === "off"
      ? "Без порога друзья слышат и шум клуба. В шумном месте включите «Авто»."
      : mode === "auto"
        ? "В шумном клубе нажмите «Калибровать» или сдвиньте ползунок «Подстройка порога» влево: пока вы молчите, соседей не будет слышно."
        : "В шумном клубе сдвиньте отметку на полосе вправо: пока вы молчите, соседей не будет слышно.";

  return (
    <Section
      title="Чувствительность"
      aside={
        <SegmentedControl
          label="Режим порога"
          size="sm"
          value={mode}
          onValueChange={(m) => updateSettings({ gateMode: m })}
          options={MODE_OPTIONS}
        />
      }
    >
      <div className="rounded-card border border-line bg-sunken px-4 pb-3 pt-4">
        <LevelMeter
          getLevelDb={monitor.getLevelDb}
          mode={meterMode}
          thresholdDb={Number.isFinite(threshold) ? threshold : undefined}
          onThresholdChange={mode === "manual" ? (db) => updateSettings({ manualThresholdDb: db }) : undefined}
        />
        {mode === "auto" && (
          <Slider
            label="Подстройка порога"
            wrapperClassName="mt-3"
            value={settings.sensitivityDb}
            onValueChange={(v) => updateSettings({ sensitivityDb: v })}
            min={SENSITIVITY_RANGE.min}
            max={SENSITIVITY_RANGE.max}
            step={1}
            marks={[0]}
            snap={1}
            formatValue={sensitivityText}
            iconStart="minus"
            iconEnd="plus"
            aria-describedby={hintId}
          />
        )}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p id={hintId} className="text-label text-ink-2">
            {caption}
            {mode === "auto" && " Влево строже, вправо чувствительнее."}
          </p>
          <Button
            size="sm"
            variant="secondary"
            icon="activity"
            disabled={mode === "off" || cal.phase === "running"}
            onClick={() => void calibrate()}
          >
            {cal.phase === "running" ? `Говорите… ${cal.left}` : "Калибровать"}
          </Button>
        </div>
        <p aria-live="polite" className="text-label">
          {cal.phase === "running" && (
            <span className="mt-2 block text-ink">Скажите обычную фразу своим голосом, как в игре.</span>
          )}
          {cal.phase === "done" && (
            <span className="mt-2 block">
              <Tone status={cal.text} />
            </span>
          )}
        </p>
        {monitor.error && (
          <p className="mt-2 text-label text-caution-ink">
            Проверка микрофона не запустилась: {monitor.error.title.toLowerCase()}.
          </p>
        )}
      </div>
      <p className="text-caption text-ink-3">{advice}</p>
    </Section>
  );
}

function ProcessingSection({ monitor }: { monitor: VoiceMonitor }) {
  const { settings, updateSettings, status, waitingForGesture, capture, setCapture } = useVoiceControls();
  const base = useId();
  const id = (name: string) => `${base}-${name}`;
  const ns = noiseSuppressionText({ enabled: settings.noiseSuppression, status, waitingForGesture });
  return (
    <Section title="Обработка">
      <div className="divide-y divide-line rounded-card border border-line px-4">
        <SettingRow
          htmlFor={id("ns")}
          title="Шумоподавление"
          description={<Tone status={ns} />}
          control={
            <Switch
              id={id("ns")}
              checked={settings.noiseSuppression}
              onCheckedChange={(on) => updateSettings({ noiseSuppression: on })}
            />
          }
        />
        {/* Два тумблера про громкость путали (ревью): этот — наш и выравнивает
            только голос, ниже — встроенный в браузер и усиливает всё подряд. */}
        <SettingRow
          htmlFor={id("own-agc")}
          title="Выравнивать громкость голоса"
          description="Тихие фразы подтягивает, крик приглушает. Слушает только ваш голос, шум клуба не усиливает"
          control={
            <Switch
              id={id("own-agc")}
              checked={settings.autoGain}
              onCheckedChange={(on) => updateSettings({ autoGain: on })}
            />
          }
        />
        <SettingRow
          htmlFor={id("ec")}
          title="Эхоподавление"
          description="Нужно, если звук идёт из колонок, а не из наушников"
          control={
            <Switch
              id={id("ec")}
              checked={capture.echoCancellation}
              onCheckedChange={(on) => setCapture({ echoCancellation: on })}
            />
          }
        />
        <SettingRow
          htmlFor={id("agc")}
          title="Автоусиление браузера"
          description="Встроено в браузер: в паузах усиливает всё подряд, и голоса соседей тоже. В клубе держите выключенным"
          control={
            <Switch
              id={id("agc")}
              checked={capture.autoGainControl}
              onCheckedChange={(on) => setCapture({ autoGainControl: on })}
            />
          }
        />
        <SettingRow
          htmlFor={id("loop")}
          title="Слышать себя"
          description="Ровно то, что слышат друзья. Наденьте наушники, иначе будет эхо"
          control={<Switch id={id("loop")} checked={monitor.loopback} onCheckedChange={monitor.setLoopback} />}
        />
      </div>
    </Section>
  );
}

function OutputSection() {
  const out = useDeviceChoice("audiooutput");
  const { master, setMaster } = useVolumes();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = (id: string) => {
    setPending(id);
    setError(null);
    out
      .select(id)
      .catch(() => setError("Это устройство сейчас недоступно. Звук остался на прежнем."))
      .finally(() => setPending(null));
  };

  return (
    <Section title="Звук">
      {out.supported ? (
        <Select
          label="Куда выводить"
          icon="headphones"
          value={pending ?? out.selected}
          options={withSelected(out.options, out.selected, "Выбранное устройство (не подключено)")}
          onChange={(e) => choose(e.target.value)}
          error={error ?? undefined}
        />
      ) : (
        <Select
          label="Куда выводить"
          icon="headphones"
          value="default"
          options={[{ value: "default", label: "Как в системе" }]}
          disabled
          hint="В этом браузере звук идёт в устройство, выбранное в системе. Выбрать другое можно в Chrome или Edge."
        />
      )}
      <Slider
        label="Общая громкость"
        value={Math.round(master * 100)}
        onValueChange={(v) => setMaster(v / 100)}
        formatValue={(v) => `${v}%`}
      />
      <p className="text-caption text-ink-3">Громкость каждого друга настраивается по клику на него.</p>
    </Section>
  );
}

"use client";

// Песочница витрины /design/rumik: собрать Румика примитивами и скопировать строку
// кода. Подписи вариантов приходят из RumikShowcase (серверного) пропсом.

import { useState } from "react";
import {
  Button,
  Rumik,
  SegmentedControl,
  Select,
  SettingRow,
  Slider,
  Switch,
  type RumikColors,
  type RumikExtra,
  type RumikEyes,
  type RumikHat,
  type RumikPose,
} from "@/components/ui";

type Opt<T extends string> = { value: T; label: string };

export type PlaygroundOptions = {
  poses: Opt<RumikPose>[];
  eyes: Opt<RumikEyes>[];
  hats: Opt<RumikHat>[];
  extras: Opt<RumikExtra>[];
  colorNames: string[];
};

type ColorMode = "one" | "quad" | "white";

const QUARTERS = ["Верх слева", "Верх справа", "Низ справа", "Низ слева"];

/** Строка JSX без значений по умолчанию: её можно вставить в код как есть. */
function toCode(p: {
  colors: RumikColors;
  pose: RumikPose;
  eyes: RumikEyes;
  hat: RumikHat | "";
  extra: RumikExtra | "";
  sticker: boolean;
  glow: boolean;
  flip: boolean;
  tilt: number;
  look: [number, number];
}): string {
  const parts: string[] = [];
  if (p.colors === "white") parts.push(`colors="white"`);
  else if (typeof p.colors === "number") parts.push(`colors={${p.colors}}`);
  else parts.push(`colors={[${p.colors.join(", ")}]}`);
  if (p.pose !== "stand") parts.push(`pose="${p.pose}"`);
  if (p.eyes !== "normal") parts.push(`eyes="${p.eyes}"`);
  if (p.hat) parts.push(`hat="${p.hat}"`);
  if (p.extra) parts.push(`extra="${p.extra}"`);
  if (p.sticker) parts.push("sticker");
  if (p.glow) parts.push("glow");
  if (p.look[0] || p.look[1]) parts.push(`look={[${p.look[0]}, ${p.look[1]}]}`);
  if (p.tilt) parts.push(`tilt={${p.tilt}}`);
  if (p.flip) parts.push("flip");
  return `<Rumik ${parts.join(" ")} />`;
}

export function RumikPlayground({ options }: { options: PlaygroundOptions }) {
  const [pose, setPose] = useState<RumikPose>("wave");
  const [eyes, setEyes] = useState<RumikEyes>("normal");
  const [hat, setHat] = useState<RumikHat | "">("cap");
  const [extra, setExtra] = useState<RumikExtra | "">("");
  const [mode, setMode] = useState<ColorMode>("quad");
  const [one, setOne] = useState(6);
  const [quad, setQuad] = useState<[number, number, number, number]>([6, 5, 4, 2]);
  const [sticker, setSticker] = useState(true);
  const [glow, setGlow] = useState(false);
  const [flip, setFlip] = useState(false);
  const [tilt, setTilt] = useState(0);
  const [lookX, setLookX] = useState(0);
  const [lookY, setLookY] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);

  const colors: RumikColors = mode === "white" ? "white" : mode === "one" ? one : quad;
  const look: [number, number] = [lookX, lookY];
  const code = toCode({ colors, pose, eyes, hat, extra, sticker, glow, flip, tilt, look });
  const props = { colors, pose, eyes, hat: hat || undefined, extra: extra || undefined, sticker, glow, flip, tilt, look };

  const colorOptions = options.colorNames.map((name, i) => ({ value: String(i), label: `${i} · ${name}` }));
  const withNone = <T extends string>(list: Opt<T>[]) => [
    { value: "", label: "Нет" },
    ...list.map((o) => ({ value: o.value, label: `${o.value} · ${o.label}` })),
  ];

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
    } catch {
      setCopied(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex min-h-[320px] items-center justify-center gap-10 rounded-panel border border-line bg-canvas px-6 py-10">
          <div className="w-full max-w-[260px]">
            <Rumik {...props} label="Румик из песочницы" />
          </div>
          <div className="flex flex-col items-center gap-6 max-sm:hidden">
            <Rumik {...props} size={64} />
            <Rumik {...props} size={32} />
          </div>
        </div>
        <div className="flex flex-col gap-2 rounded-card border border-line bg-sunken p-3 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 break-words px-1 font-code text-label text-ink">{code}</code>
          <Button size="sm" variant="secondary" icon={copied === code ? "check" : "copy"} onClick={copy} className="self-start sm:self-auto">
            {copied === code ? "Скопировано" : "Скопировать"}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Поза"
            size="sm"
            value={pose}
            onChange={(e) => setPose(e.target.value as RumikPose)}
            options={options.poses.map((o) => ({ value: o.value, label: `${o.value} · ${o.label}` }))}
          />
          <Select
            label="Глаза"
            size="sm"
            value={eyes}
            onChange={(e) => setEyes(e.target.value as RumikEyes)}
            options={options.eyes.map((o) => ({ value: o.value, label: `${o.value} · ${o.label}` }))}
          />
          <Select
            label="Шапка"
            size="sm"
            value={hat}
            onChange={(e) => setHat(e.target.value as RumikHat | "")}
            options={withNone(options.hats)}
          />
          <Select
            label="Значок"
            size="sm"
            value={extra}
            onChange={(e) => setExtra(e.target.value as RumikExtra | "")}
            options={withNone(options.extras)}
          />
        </div>

        <div className="flex flex-col gap-3">
          <SegmentedControl
            label="Цвет тела"
            size="sm"
            block
            value={mode}
            onValueChange={setMode}
            options={[
              { value: "one", label: "Один" },
              { value: "quad", label: "Четверти" },
              { value: "white", label: "Белый" },
            ]}
          />
          {mode === "one" && (
            <Select
              label="Цвет"
              size="sm"
              value={String(one)}
              onChange={(e) => setOne(Number(e.target.value))}
              options={colorOptions}
            />
          )}
          {mode === "quad" && (
            <div className="grid grid-cols-2 gap-3">
              {QUARTERS.map((q, i) => (
                <Select
                  key={q}
                  label={q}
                  size="sm"
                  value={String(quad[i])}
                  onChange={(e) => {
                    const next = [...quad] as typeof quad;
                    next[i] = Number(e.target.value);
                    setQuad(next);
                  }}
                  options={colorOptions}
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col divide-y divide-line">
          <SettingRow
            htmlFor="rk-sticker"
            title="Наклейка"
            description="sticker: белый край"
            control={<Switch id="rk-sticker" size="sm" checked={sticker} onCheckedChange={setSticker} />}
          />
          <SettingRow
            htmlFor="rk-glow"
            title="Говорит"
            description="glow: обводка и свечение вместо наклейки"
            control={<Switch id="rk-glow" size="sm" checked={glow} onCheckedChange={setGlow} />}
          />
          <SettingRow
            htmlFor="rk-flip"
            title="Отразить"
            description="flip: смотрит в другую сторону"
            control={<Switch id="rk-flip" size="sm" checked={flip} onCheckedChange={setFlip} />}
          />
        </div>

        <Slider label="Наклон" value={tilt} onValueChange={setTilt} min={-15} max={15} marks={[0]} snap={2} formatValue={(v) => `${v}°`} />
        <div className="grid grid-cols-2 gap-4">
          <Slider label="Взгляд по x" value={lookX} onValueChange={setLookX} min={-4} max={4} marks={[0]} formatValue={(v) => String(v)} />
          <Slider label="Взгляд по y" value={lookY} onValueChange={setLookY} min={-4} max={4} marks={[0]} formatValue={(v) => String(v)} />
        </div>
      </div>
    </div>
  );
}

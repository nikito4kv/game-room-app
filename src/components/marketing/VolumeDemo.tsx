"use client";

import { useState } from "react";
import { Slider } from "@/components/ui/Slider";

/**
 * Живой ползунок «громкость друга»: тот же примитив, что в комнате. Его можно
 * подвигать прямо на странице: так видно, что значит «до 200%». Звука здесь нет,
 * это только демонстрация.
 */
export function VolumeDemo() {
  const [value, setValue] = useState(100);
  return (
    <Slider
      label="Громкость Ники (пример)"
      value={value}
      onValueChange={setValue}
      min={0}
      max={200}
      step={5}
      marks={[100]}
      snap={8}
      formatValue={(v) => `${v}%`}
      iconStart="volume-low"
      iconEnd="volume"
    />
  );
}

"use client";

import { useCatalogSync } from "./useCatalogSync";

/** Невидимый компонент: держит каталог звуков комнаты актуальным. */
export default function SoundCatalogSync() {
  useCatalogSync();
  return null;
}

// Как выглядят звуки соундборда. Чистые данные (без React): названия вшитых
// звуков, значок над местом сыгравшего и жест Румика. Названия готового набора и
// звуков комнаты приходят из каталога (catalog.ts).
import type { GlyphSpec } from "@/components/ui/Glyph";
import type { RumikEyes, RumikPose } from "@/components/ui/Rumik";
import type { BuiltinSoundId } from "@/lib/api/contract";

/** Названия вшитых (синтезируемых) звуков — запасной набор, пока нет готового. */
export const BUILTIN_SOUND_NAMES: Readonly<Record<BuiltinSoundId, string>> = {
  rimshot: "Ба-дум-тсс",
  tada: "Та-дам",
  fail: "Грустный тромбон",
  horn: "Дудка",
  crickets: "Сверчки",
  correct: "Верно",
  wrong: "Мимо",
  applause: "Аплодисменты",
};

/** Над местом сыгравшего всплывает один и тот же значок: какой именно звук, видно по названию в ленте и слышно. */
export const SOUND_BUBBLE: { glyph: GlyphSpec; label: string; spoken: string; pose: RumikPose; eyes: RumikEyes } = {
  glyph: { icon: "music" },
  label: "Играет звук",
  spoken: "звук",
  pose: "cheer",
  eyes: "wink",
};

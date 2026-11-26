// Как выглядит реакция: значок в пузыре и жест Румика. Чистые данные и функции
// (без React) — их читают пузырь, жест, кнопка дока и тесты.
//
// Пузырь над местом показывает и звуки соундборда (🥁 у того, кто сыграл
// «ба-дум-тсс»), и игры (грань кубика, 🎯 «выпало на тебя», ✅ «готов»),
// поэтому пузырь, жест и объявления знают BubbleKind; вид звуков — в
// ../sounds/view.ts, игр — в ../games/view.ts.
import type { ReactionKind } from "@/lib/api/contract";
import type { GlyphSpec } from "@/components/ui/Glyph";
import type { RumikEyes, RumikPose } from "@/components/ui/Rumik";
import { GAME_GESTURES, GAME_VIEW, type GameBubble } from "../games/view";
import { SOUND_BUBBLE } from "../sounds/view";
import type { ActiveReaction } from "./reactionStore";

/** Что всплывает над местом: реакция, звук соундборда или игра. */
export type BubbleKind = ReactionKind | GameBubble | "sound";

/** Жест Румика в ответ на реакцию: поза и глаза на пару секунд. */
export type ReactionGesture = {
  kind: BubbleKind;
  pose: RumikPose;
  eyes?: RumikEyes;
  /** Когда пришла реакция (Date.now()): ключ для короткой анимации. */
  at: number;
};

/**
 * Позы и глаза — из того, что Румик уже умеет: 👍 машет, 🔥 обе руки вверх,
 * 😂 держится за живот и жмурится, GG — руки вверх и глаза круглые.
 */
export const REACTION_GESTURES: Readonly<Record<ReactionKind, { pose: RumikPose; eyes?: RumikEyes }>> = {
  like: { pose: "wave" },
  fire: { pose: "cheer" },
  lol: { pose: "laugh", eyes: "wink" },
  gg: { pose: "cheer", eyes: "wide" },
};

/** Жесты реакций, звуков и игр. */
export const BUBBLE_GESTURES: Readonly<Record<BubbleKind, { pose: RumikPose; eyes?: RumikEyes }>> = {
  ...REACTION_GESTURES,
  ...GAME_GESTURES,
  sound: { pose: SOUND_BUBBLE.pose, eyes: SOUND_BUBBLE.eyes },
};

export function gestureFor(reaction: ActiveReaction): ReactionGesture {
  const g = BUBBLE_GESTURES[reaction.kind];
  return g.eyes
    ? { kind: reaction.kind, pose: g.pose, eyes: g.eyes, at: reaction.at }
    : { kind: reaction.kind, pose: g.pose, at: reaction.at };
}

/**
 * Значок в пузыре и на кнопке, подпись (подсказка, aria-label) и как сказать
 * скринридером. GG — надпись, а не эмодзи.
 */
export const REACTION_VIEW: Readonly<Record<ReactionKind, { glyph: GlyphSpec; label: string; spoken: string }>> = {
  like: { glyph: { icon: "thumbs-up", tone: "text-signal-ink" }, label: "Класс", spoken: "класс" },
  fire: { glyph: { icon: "flame", tone: "text-caution-ink" }, label: "Огонь", spoken: "огонь" },
  lol: { glyph: { icon: "laugh", tone: "text-crown" }, label: "Смешно", spoken: "смешно" },
  gg: { glyph: { text: "GG" }, label: "GG, хорошая игра", spoken: "GG" },
};

/** Вид всего, что всплывает над местом: реакций, звуков и игр. */
export const BUBBLE_VIEW: Readonly<Record<BubbleKind, { glyph: GlyphSpec; label: string; spoken: string }>> = {
  ...REACTION_VIEW,
  ...GAME_VIEW,
  sound: { glyph: SOUND_BUBBLE.glyph, label: SOUND_BUBBLE.label, spoken: SOUND_BUBBLE.spoken },
};

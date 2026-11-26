import { COPY, SHARED } from "../copy";
import { RoundTable } from "../components/RoundTable";
import { Split, useVisualBox } from "../components/Scene";
import { Headline, Kicker, Sub } from "../components/Type";
import { useFormat } from "../fx";
import { buildSeats } from "../table";

/** Подпись в центре стола: код комнаты (как в продукте). */
export function TableCenter({ size }: { size: number }) {
  return (
    <div style={{ fontFamily: "var(--gr-font-body)", color: "var(--gr-ink-3)", fontSize: size * 0.034 }}>
      <div>код комнаты</div>
      <div
        style={{
          marginTop: size * 0.012,
          fontFamily: "var(--gr-font-brand)",
          fontWeight: 600,
          letterSpacing: "0.16em",
          fontSize: size * 0.055,
          color: "var(--gr-ink)",
        }}
      >
        {SHARED.roomCode}
      </div>
    </div>
  );
}

/**
 * Крючок: «зови друзей — слышно всех, без регистрации». За столом пока пусто
 * (пунктир), друзья по одному заходят, и у первого загорается кольцо.
 */
export function SceneHook() {
  const { tall } = useFormat();
  const box = useVisualBox();
  const size = Math.min(box.w, box.h, tall ? 760 : 800) * (tall ? 0.92 : 1);
  const seats = buildSeats({
    appear: [10, 20, 30, 40, 50],
    speaking: {
      Тёма: [
        [28, 70],
        [118, 200],
      ],
      Ника: [[72, 116]],
    },
  });
  return (
    <Split
      textWidth={900}
      text={
        <>
          <Kicker delay={2}>{SHARED.roomName}</Kicker>
          <Headline text={COPY.hook.title} delay={4} size={tall ? 104 : 92} maxWidth={tall ? 936 : 900} />
          <Sub delay={22} maxWidth={tall ? 900 : 700}>
            {COPY.hook.sub}
          </Sub>
        </>
      }
      visual={<RoundTable size={size} seats={seats} ghosts center={<TableCenter size={size} />} />}
    />
  );
}

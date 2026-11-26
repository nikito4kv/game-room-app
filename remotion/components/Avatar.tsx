import { useCurrentFrame } from "remotion";
import { Icon, type IconName } from "./Icon";

export type AvatarStatus = "muted" | "deafened" | "forceMuted" | "ptt";

const STATUS: Record<AvatarStatus, { icon: IconName; bg: string; fg: string }> = {
  muted: { icon: "mic-off", bg: "var(--gr-overlay)", fg: "var(--gr-alert-ink)" },
  deafened: { icon: "headphones-off", bg: "var(--gr-overlay)", fg: "var(--gr-alert-ink)" },
  forceMuted: { icon: "mic-off", bg: "var(--gr-alert)", fg: "var(--gr-on-alert)" },
  ptt: { icon: "radio", bg: "var(--gr-overlay)", fg: "var(--gr-ink-2)" },
};

/**
 * Аватар участника, как в продукте (src/components/ui/Avatar.tsx): кружок
 * цвета участника с инициалом, кольцо «говорит» цвета signal и расходящаяся
 * тонкая волна, значок состояния в углу.
 *
 * speak — «насколько говорит» 0…1 (плавно включается и выключается);
 * level — громкость 0…1 (кольцо дышит).
 */
export function Avatar({
  name,
  color,
  size = 120,
  speak = 0,
  level = 0.7,
  status,
  seed = 0,
  cutout = "var(--gr-canvas)",
}: {
  name: string;
  color: number;
  size?: number;
  speak?: number;
  level?: number;
  status?: AvatarStatus | null;
  seed?: number;
  /** Цвет «выреза» вокруг значка — цвет поверхности под аватаром. */
  cutout?: string;
}) {
  const frame = useCurrentFrame();
  const ringW = Math.max(2.5, Math.round(size * 0.03));
  const gap = ringW;
  const ringInset = -(gap + ringW);
  const st = status ? STATUS[status] : null;
  const badge = Math.round(size * 0.34);

  // Две волны, расходящиеся по очереди: тонкие кольца без размытия.
  const waves = [0, 1].map((k) => {
    const p = ((frame + seed * 7 + k * 20) % 40) / 40;
    return { p, o: (1 - p) * 0.5 * speak * (0.45 + 0.55 * level), s: 1 + p * 0.42 };
  });

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      {waves.map((w, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            inset: ringInset,
            borderRadius: "50%",
            border: `${Math.max(1.5, ringW - 1)}px solid var(--gr-signal)`,
            opacity: w.o,
            transform: `scale(${w.s})`,
          }}
        />
      ))}
      <div
        style={{
          position: "absolute",
          inset: ringInset,
          borderRadius: "50%",
          border: `${ringW}px solid var(--gr-signal)`,
          opacity: speak * (0.78 + 0.22 * level),
          transform: `scale(${1 + 0.05 * level * speak})`,
        }}
      />
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: "50%",
          background: `var(--gr-avatar-${color})`,
          color: "var(--gr-avatar-ink)",
          display: "grid",
          placeItems: "center",
          fontFamily: "var(--gr-font-brand)",
          fontWeight: 600,
          fontSize: Math.round(size * 0.42),
          lineHeight: 1,
        }}
      >
        {name.charAt(0).toUpperCase()}
      </div>
      {st && (
        <div
          style={{
            position: "absolute",
            width: badge,
            height: badge,
            right: -Math.round(badge * 0.18),
            bottom: -Math.round(badge * 0.18),
            borderRadius: "50%",
            background: st.bg,
            color: st.fg,
            display: "grid",
            placeItems: "center",
            boxShadow: `0 0 0 ${Math.max(3, Math.round(size * 0.03))}px ${cutout}`,
          }}
        >
          <Icon name={st.icon} size={Math.round(badge * 0.62)} sw={2.3} />
        </div>
      )}
    </div>
  );
}

import { COPY } from "../copy";
import { RoundTable } from "../components/RoundTable";
import { Split, TextBlock, useVisualBox } from "../components/Scene";
import { Chip } from "../components/Type";
import { useFormat } from "../fx";
import { buildSeats } from "../table";
import { TableCenter } from "./Hook";

/**
 * Решение 2: стол с говорящими. Кольцо переходит от Тёмы к Нике и Сане;
 * у Лёхи «микрофон выкл», у Дани «звук выкл» — значки в углу аватара, как в продукте.
 */
export function SceneVoice() {
  const { tall } = useFormat();
  const box = useVisualBox();
  const size = Math.min(box.w, box.h) * (tall ? 0.86 : 0.98);
  const seats = buildSeats({
    speaking: {
      Тёма: [[6, 40]],
      Ника: [[38, 72]],
      Саня: [[70, 112]],
    },
    status: { Лёха: "muted", Даня: "deafened", Саня: "ptt" },
  });
  return (
    <Split
      text={
        <>
          <TextBlock kicker={COPY.voice.kicker} title={COPY.voice.title} sub={COPY.voice.sub} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 8 }}>
            {COPY.voice.legend.map((l, i) => (
              <Chip key={l.text} icon={l.icon} tone={l.tone} size={tall ? 30 : 26} delay={40 + i * 8}>
                {l.text}
              </Chip>
            ))}
          </div>
        </>
      }
      visual={<RoundTable size={size} seats={seats} center={<TableCenter size={size} />} />}
    />
  );
}

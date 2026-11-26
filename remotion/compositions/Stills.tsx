import { AbsoluteFill, Sequence } from "remotion";
import { COPY } from "../copy";
import { Lockup } from "../components/Logo";
import { RoundTable } from "../components/RoundTable";
import { Backdrop } from "../components/Scene";
import { Headline, Sub } from "../components/Type";
import { TableCenter } from "../scenes/Hook";
import { buildSeats } from "../table";
import type { PromoProps } from "./Promo";

/** Кадр, в котором всё уже «приехало»: все сидят, Тёма говорит. Sequence со сдвигом назад заставляет useCurrentFrame() вернуть этот кадр. */
const STILL_FRAME = 130;

const seats = () =>
  buildSeats({
    speaking: {
      Тёма: [[0, 400]],
    },
  });

function UrlPill({ url, size }: { url: string; size: number }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: `${size * 0.4}px ${size * 0.8}px`,
        borderRadius: 999,
        border: "1px solid var(--gr-line-control)",
        background: "var(--gr-wash-2)",
        fontFamily: "var(--gr-font-brand)",
        fontWeight: 600,
        fontSize: size,
        color: "var(--gr-ink)",
        whiteSpace: "nowrap",
      }}
    >
      {url}
    </div>
  );
}

/** Постер 1200×630: картинка для превью ссылок, постов и обложек. */
export const Poster = ({ url }: PromoProps) => (
  <Sequence from={-STILL_FRAME} layout="none">
    <AbsoluteFill style={{ background: "var(--gr-canvas)", fontFamily: "var(--gr-font-body)" }}>
      <Backdrop lampX={0.74} lampY={0.5} />
      <AbsoluteFill style={{ padding: "58px 70px" }}>
        <Lockup height={46} id="poster" />
        <div style={{ marginTop: 74, display: "flex", flexDirection: "column", gap: 22 }}>
          <Headline text={COPY.poster.title} size={64} maxWidth={620} />
          <Sub size={26} maxWidth={520}>
            {COPY.poster.sub}
          </Sub>
        </div>
        <div style={{ position: "absolute", left: 70, bottom: 54 }}>
          <UrlPill url={url} size={24} />
        </div>
      </AbsoluteFill>
      <div style={{ position: "absolute", right: 36, top: 52, width: 540, height: 540 }}>
        <RoundTable size={540} seats={seats()} center={<TableCenter size={540} />} avatarRatio={0.16} />
      </div>
    </AbsoluteFill>
  </Sequence>
);

/** Квадрат 1080×1080: для постов в ленту. */
export const Square = ({ url }: PromoProps) => (
  <Sequence from={-STILL_FRAME} layout="none">
    <AbsoluteFill style={{ background: "var(--gr-canvas)", fontFamily: "var(--gr-font-body)" }}>
      <Backdrop />
      <AbsoluteFill style={{ padding: "72px 80px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Lockup height={52} id="square" />
          <UrlPill url={url} size={26} />
        </div>
        <div style={{ marginTop: 46, display: "flex", flexDirection: "column", gap: 22 }}>
          <Headline text={COPY.square.title} size={86} maxWidth={920} />
          <Sub size={32} maxWidth={720}>
            {COPY.square.sub}
          </Sub>
        </div>
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 540 - 240, top: 548, width: 480, height: 480 }}>
        <RoundTable size={480} seats={seats()} center={<TableCenter size={480} />} avatarRatio={0.16} />
      </div>
    </AbsoluteFill>
  </Sequence>
);


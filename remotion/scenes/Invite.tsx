import { interpolate, useCurrentFrame } from "remotion";
import { COPY, SHARED } from "../copy";
import { BrowserFrame } from "../components/Frames";
import { Icon } from "../components/Icon";
import { Split, TextBlock } from "../components/Scene";
import { Toast } from "../components/Widgets";
import { EASE_IN_OUT, prog, useFormat, useSpring } from "../fx";

/** Курсор мыши (белый с чёрной обводкой). */
function Cursor({ x, y, press }: { x: number; y: number; press: number }) {
  return (
    <svg
      width={44}
      height={44}
      viewBox="0 0 24 24"
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: `scale(${1 - 0.14 * press})`,
        transformOrigin: "4px 3px",
        filter: "drop-shadow(0 4px 6px rgb(0 0 0 / 0.5))",
      }}
    >
      <path d="M4 3l15 8.2-6.6 1.6L9.6 19.4z" fill="#fff" stroke="#0d0e11" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Решение 1: ссылка улетает другу, друг заходит в один клик, без регистрации.
 * Кадр лобби — настоящий скриншот макета /design/lobby.
 */
export function SceneInvite() {
  const frame = useCurrentFrame();
  const { tall } = useFormat();
  const W = tall ? 936 : 920;
  const bar = Math.round(W * 0.046);
  const screenH = Math.round(W / (1440 / 900));
  const H = bar + screenH;

  const frameIn = useSpring(4);
  const bubbleIn = useSpring(14, { damping: 18, stiffness: 130 });
  const toastIn = useSpring(76, { damping: 20, stiffness: 120 });

  // Кнопка «Войти в комнату» на скриншоте: x≈70.9 %, y≈64.1 % экрана.
  const btn = { x: W * 0.709, y: bar + screenH * 0.641 };
  const start = { x: W * 0.3, y: H * 1.02 };
  const move = prog(frame, 38, 64, EASE_IN_OUT);
  const cx = interpolate(move, [0, 1], [start.x, btn.x]);
  const cy = interpolate(move, [0, 1], [start.y, btn.y]);
  const press = prog(frame, 66, 70) * (1 - prog(frame, 72, 78));
  const curOpacity = prog(frame, 34, 40);
  const ring = prog(frame, 68, 92);
  const bubbleS = tall ? 1.15 : 1;

  return (
    <Split
      textWidth={740}
      text={<TextBlock kicker={COPY.invite.kicker} title={COPY.invite.title} sub={COPY.invite.sub} />}
      visual={
        <div style={{ position: "relative", width: W, height: H }}>
          <div style={{ opacity: frameIn, transform: `translateY(${(1 - frameIn) * 40}px)` }}>
            <BrowserFrame shot="lobby.png" width={W} url={SHARED.link} />
          </div>

          {/* Подсветка нажатия на кнопку */}
          <div
            style={{
              position: "absolute",
              left: btn.x - W * 0.17,
              top: btn.y - H * 0.037,
              width: W * 0.34,
              height: H * 0.074,
              borderRadius: 14,
              border: "3px solid var(--gr-signal)",
              opacity: (1 - ring) * prog(frame, 66, 70),
              transform: `scale(${1 + ring * 0.2})`,
            }}
          />

          {/* Сообщение другу со ссылкой */}
          <div
            style={{
              position: "absolute",
              left: -W * 0.03,
              bottom: -H * 0.07,
              opacity: bubbleIn,
              transform: `translateY(${(1 - bubbleIn) * 40}px) scale(${bubbleS})`,
              transformOrigin: "left bottom",
              width: W * 0.68,
              padding: "22px 28px",
              borderRadius: "26px 26px 26px 8px",
              background: "var(--gr-overlay)",
              boxShadow: "var(--gr-shadow-float)",
              fontFamily: "var(--gr-font-body)",
            }}
          >
            <div style={{ fontSize: 30, color: "var(--gr-ink)", fontWeight: 500 }}>{COPY.invite.message}</div>
            <div
              style={{
                marginTop: 8,
                fontSize: 25,
                color: "var(--gr-link)",
                display: "flex",
                alignItems: "center",
                gap: 12,
                whiteSpace: "nowrap",
              }}
            >
              <Icon name="link" size={28} sw={2} />
              {SHARED.link}
            </div>
          </div>

          <div style={{ opacity: curOpacity }}>
            <Cursor x={cx} y={cy} press={press} />
          </div>

          {/* «Ника теперь в комнате» */}
          <div
            style={{
              position: "absolute",
              right: W * 0.03,
              top: bar + 20,
              opacity: toastIn,
              transform: `translateY(${(1 - toastIn) * -24}px)`,
            }}
          >
            <Toast
              title={COPY.invite.toastTitle}
              text={COPY.invite.toastText}
              person={{ name: COPY.invite.toastTitle, color: SHARED.people[4].color }}
              scale={tall ? 0.8 : 0.95}
            />
          </div>
        </div>
      }
    />
  );
}

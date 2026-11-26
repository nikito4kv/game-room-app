import { useCurrentFrame } from "remotion";
import { hash01 } from "../fx";

/**
 * Абстрактный «игровой» кадр-заглушка: сетка арены, пара стен, несколько
 * движущихся фишек и минимальный интерфейс. Никаких чужих торговых марок,
 * реальных игр и скриншотов чужих игр. Цвета намеренно «не бренд»: лайм
 * (signal) в нём не используется, он в продукте значит «передаёт».
 */
export function GameScreen({ width, height }: { width: number; height: number }) {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const cell = width / 16;

  // Фишки двигаются по плавным орбитам (синусы), без случайности.
  const units = [
    { color: "#5b8cff", fx: 0.37, fy: 0.29, ax: 0.26, ay: 0.2, px: 0.1, py: 0.6, r: 0.021, mine: true },
    { color: "#5b8cff", fx: 0.31, fy: 0.43, ax: 0.2, ay: 0.16, px: 1.7, py: 0.2, r: 0.016 },
    { color: "#5b8cff", fx: 0.27, fy: 0.34, ax: 0.15, ay: 0.22, px: 3.1, py: 2.1, r: 0.016 },
    { color: "#ff6b8b", fx: 0.23, fy: 0.41, ax: 0.28, ay: 0.18, px: 2.2, py: 1.1, r: 0.017 },
    { color: "#ff6b8b", fx: 0.33, fy: 0.25, ax: 0.22, ay: 0.21, px: 4.4, py: 3.3, r: 0.017 },
    { color: "#ffb454", fx: 0.18, fy: 0.22, ax: 0.1, ay: 0.12, px: 0.9, py: 4.0, r: 0.012 },
  ];

  const walls = [
    { x: 0.12, y: 0.18, w: 0.16, h: 0.05 },
    { x: 0.62, y: 0.22, w: 0.05, h: 0.26 },
    { x: 0.36, y: 0.52, w: 0.22, h: 0.05 },
    { x: 0.16, y: 0.66, w: 0.05, h: 0.2 },
    { x: 0.72, y: 0.7, w: 0.16, h: 0.05 },
  ];

  const scroll = (t * 6) % cell;

  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        overflow: "hidden",
        background: "linear-gradient(160deg, #101a33 0%, #0b1226 55%, #080d1c 100%)",
      }}
    >
      {/* Сетка арены */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgb(120 160 255 / 0.08) 1px, transparent 1px), linear-gradient(90deg, rgb(120 160 255 / 0.08) 1px, transparent 1px)",
          backgroundSize: `${cell}px ${cell}px`,
          backgroundPosition: `${-scroll}px ${-scroll * 0.5}px`,
        }}
      />
      {/* Стены */}
      {walls.map((w, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: w.x * width,
            top: w.y * height,
            width: w.w * width,
            height: w.h * height,
            borderRadius: width * 0.008,
            background: "rgb(150 175 255 / 0.1)",
            border: "1px solid rgb(150 175 255 / 0.18)",
          }}
        />
      ))}
      {/* Следы выстрелов */}
      {[0, 1, 2, 3].map((i) => {
        const p = ((t * 0.9 + i * 0.27) % 1);
        const y = (0.2 + hash01(i + 3) * 0.6) * height;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: (0.1 + p * 0.8) * width,
              top: y,
              width: width * 0.05,
              height: 3,
              borderRadius: 2,
              background: i % 2 ? "#ff6b8b" : "#5b8cff",
              opacity: 0.35 * (1 - Math.abs(p - 0.5) * 2),
            }}
          />
        );
      })}
      {/* Фишки */}
      {units.map((u, i) => {
        const x = 0.5 + u.ax * Math.sin(t * u.fx * 2 + u.px);
        const y = 0.5 + u.ay * Math.sin(t * u.fy * 2 + u.py);
        const d = u.r * width * 2;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x * width - d / 2,
              top: y * height - d / 2,
              width: d,
              height: d,
              borderRadius: "50%",
              background: u.color,
              boxShadow: `0 0 0 ${d * 0.28}px ${u.color}33, 0 0 ${d * 1.4}px ${u.color}88`,
              outline: u.mine ? "2px solid #fff" : undefined,
              outlineOffset: u.mine ? d * 0.25 : undefined,
            }}
          />
        );
      })}

      {/* Минимальный интерфейс: полоска здоровья слева сверху */}
      <div style={{ position: "absolute", left: width * 0.025, top: height * 0.045, display: "flex", gap: width * 0.004 }}>
        {Array.from({ length: 10 }, (_, i) => (
          <div
            key={i}
            style={{
              width: width * 0.016,
              height: height * 0.022,
              borderRadius: 3,
              background: i < 7 ? "#5b8cff" : "rgb(255 255 255 / 0.12)",
            }}
          />
        ))}
      </div>
      {/* Миникарта справа сверху */}
      <div
        style={{
          position: "absolute",
          right: width * 0.025,
          top: height * 0.045,
          width: width * 0.11,
          height: width * 0.11 * 0.62,
          borderRadius: width * 0.006,
          background: "rgb(255 255 255 / 0.06)",
          border: "1px solid rgb(255 255 255 / 0.12)",
        }}
      >
        {units.map((u, i) => {
          const x = 0.5 + u.ax * Math.sin(t * u.fx * 2 + u.px);
          const y = 0.5 + u.ay * Math.sin(t * u.fy * 2 + u.py);
          return (
            <span
              key={i}
              style={{
                position: "absolute",
                left: `${x * 100}%`,
                top: `${y * 100}%`,
                width: 6,
                height: 6,
                marginLeft: -3,
                marginTop: -3,
                borderRadius: "50%",
                background: u.color,
              }}
            />
          );
        })}
      </div>
      {/* Способности снизу по центру */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: height * 0.05,
          transform: "translateX(-50%)",
          display: "flex",
          gap: width * 0.008,
        }}
      >
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              width: width * 0.04,
              height: width * 0.04,
              borderRadius: width * 0.008,
              background: "rgb(255 255 255 / 0.07)",
              border: "1px solid rgb(255 255 255 / 0.14)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

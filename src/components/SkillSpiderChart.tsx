"use client";

const AXES = [
  { key: "vocab",   label: "文字", sub: "Moji",    color: "#7F77DD" },
  { key: "grammar", label: "文法", sub: "Bunpou",  color: "#EF9F27" },
  { key: "reading", label: "読解", sub: "Dokkai",  color: "#1D9E75" },
  { key: "listen",  label: "聴解", sub: "Choukai", color: "#378ADD" },
] as const;

interface SkillSpiderChartProps {
  /** Array of 4 values in [0, 1]: [vocab, grammar, reading, listen] */
  values?: number[];
  width?: number;
  height?: number;
}

export default function SkillSpiderChart({
  values = [0, 0, 0, 0],
  width = 300,
  height = 280,
}: SkillSpiderChartProps) {
  const cx = width / 2;
  const cy = height / 2 - 2;
  const R = Math.min(width, height) / 2 - 55;
  const n = AXES.length;

  function pt(i: number, r: number): [number, number] {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }

  const safeValues = Array.from({ length: n }, (_, i) => {
    const v = Number(values[i]);
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(1, v));
  });

  const polyline = safeValues
    .map((v, i) => pt(i, v * R))
    .map((p) => p.join(","))
    .join(" ");

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} xmlns="http://www.w3.org/2000/svg">
      {/* Concentric grid polygons (5 rings at 20/40/60/80/100%) */}
      {[0.2, 0.4, 0.6, 0.8, 1.0].map((frac, i) => {
        const pts = Array.from({ length: n }, (_, idx) => pt(idx, R * frac))
          .map((p) => p.join(","))
          .join(" ");
        return (
          <polygon key={i} points={pts} fill="none" stroke="rgba(0,0,0,0.10)" strokeWidth="1" />
        );
      })}
      {/* Radial axes */}
      {AXES.map((_, i) => {
        const [x, y] = pt(i, R);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(0,0,0,0.1)" strokeWidth="1" />;
      })}
      {/* Data polygon */}
      <polygon
        points={polyline}
        fill="rgba(127,119,221,0.18)"
        stroke="#7F77DD"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* Vertex dots */}
      {safeValues.map((v, i) => {
        const [x, y] = pt(i, v * R);
        return (
          <circle key={i} cx={x} cy={y} r="5" fill={AXES[i].color} stroke="#fff" strokeWidth="1.5" />
        );
      })}
      {/* Axis labels */}
      {AXES.map((ax, i) => {
        const [lx, ly] = pt(i, R + 26);
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        const anchor: "start" | "middle" | "end" =
          Math.abs(Math.cos(angle)) < 0.1 ? "middle" : Math.cos(angle) > 0 ? "start" : "end";
        return (
          <g key={i}>
            <text
              x={lx}
              y={ly - 5}
              textAnchor={anchor}
              fontSize="14"
              fontWeight="500"
              fill={ax.color}
              fontFamily="Be Vietnam Pro,Noto Sans JP,sans-serif"
            >
              {ax.label}
            </text>
            <text
              x={lx}
              y={ly + 9}
              textAnchor={anchor}
              fontSize="11"
              fill="rgba(0,0,0,0.38)"
              fontFamily="Be Vietnam Pro,Noto Sans JP,sans-serif"
            >
              ({ax.sub})
            </text>
          </g>
        );
      })}
    </svg>
  );
}

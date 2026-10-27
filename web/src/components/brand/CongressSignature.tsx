import { useId, useMemo } from "react";
import { eventAccent, seededRandom, type AccentSpec } from "../../lib/eventAccent";

interface CongressSignatureProps {
  /** Congress slug (or any stable id); the same seed always draws the same artwork. */
  seed: string;
  tone?: "ink" | "light";
  /** Draw the arcs in on mount (disabled automatically under prefers-reduced-motion). */
  animate?: boolean;
  /** Accent chosen in Page Studio; "auto"/absent derives it from the seed. */
  accent?: AccentSpec;
  className?: string;
}

interface Orbit {
  r: number;
  dash?: string;
  opacity: number;
}

/**
 * Generative "Crossing Arcs" artwork: a congress-specific composition of orbit lines, two
 * crossing brand arcs (after the AIteb mark) and network nodes. Decorative only.
 */
export function CongressSignature({ seed, tone = "ink", animate = false, accent: accentChoice, className = "" }: CongressSignatureProps) {
  const uid = useId().replace(/:/g, "");
  const accent = eventAccent(seed, accentChoice);
  const art = useMemo(() => {
    const rand = seededRandom(seed);
    const W = 800;
    const H = 600;
    const cx = W * (0.78 + rand() * 0.3);
    const cy = H * (0.95 + rand() * 0.35);
    const orbits: Orbit[] = Array.from({ length: 9 }, (_, i) => ({
      r: 120 + i * (58 + rand() * 10),
      dash: rand() > 0.62 ? `${2 + Math.round(rand() * 3)} ${6 + Math.round(rand() * 10)}` : undefined,
      opacity: 0.07 + rand() * 0.12,
    }));
    const nodes = Array.from({ length: 7 }, () => {
      const o = orbits[2 + Math.floor(rand() * (orbits.length - 2))];
      const angle = Math.PI * (1.02 + rand() * 0.46);
      return { x: cx + o.r * Math.cos(angle), y: cy + o.r * Math.sin(angle), r: 2.5 + rand() * 3, halo: rand() > 0.55 };
    }).filter((n) => n.x > 20 && n.x < W - 20 && n.y > 20 && n.y < H - 20);
    // Two thick arcs that cross, echoing the two strokes of the AIteb mark.
    const sweepA = 0.55 + rand() * 0.25;
    const arcA = {
      cx: W * (0.15 + rand() * 0.2),
      cy: H * (1.05 + rand() * 0.2),
      r: 360 + rand() * 120,
    };
    const arcB = {
      cx: W * (1.0 + rand() * 0.15),
      cy: H * (-0.05 - rand() * 0.15),
      r: 330 + rand() * 120,
    };
    const arcPath = (c: { cx: number; cy: number; r: number }, from: number, to: number) => {
      const x1 = c.cx + c.r * Math.cos(from);
      const y1 = c.cy + c.r * Math.sin(from);
      const x2 = c.cx + c.r * Math.cos(to);
      const y2 = c.cy + c.r * Math.sin(to);
      return `M${x1.toFixed(1)} ${y1.toFixed(1)} A${c.r.toFixed(1)} ${c.r.toFixed(1)} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
    };
    return {
      W,
      H,
      cx,
      cy,
      orbits,
      nodes,
      glow: { x: W * (0.25 + rand() * 0.5), y: H * (0.2 + rand() * 0.5) },
      pathA: arcPath(arcA, Math.PI * 1.08, Math.PI * (1.08 + sweepA)),
      pathB: arcPath(arcB, Math.PI * 0.52, Math.PI * (0.52 + 0.42 + rand() * 0.2)),
    };
  }, [seed]);

  const ink = tone === "ink";
  const line = ink ? "#FFFFFF" : accent.accent;
  const drawClass = animate ? "motion-safe:animate-draw" : "";

  return (
    <svg
      viewBox={`0 0 ${art.W} ${art.H}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
      className={`block ${className}`.trim()}
    >
      <defs>
        <linearGradient id={`arc-a-${uid}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#FF97FF" />
          <stop offset="1" stopColor={ink ? "#5B3FF5" : "#2000CD"} />
        </linearGradient>
        <linearGradient id={`arc-b-${uid}`} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={ink ? "#8770FF" : "#3D35DF"} />
          <stop offset="1" stopColor="#FF97FF" />
        </linearGradient>
        <radialGradient id={`glow-${uid}`} cx={art.glow.x / art.W} cy={art.glow.y / art.H} r="0.55">
          <stop offset="0" stopColor={accent.glow} stopOpacity={ink ? 0.38 : 0.22} />
          <stop offset="1" stopColor={accent.glow} stopOpacity="0" />
        </radialGradient>
      </defs>
      {ink && <rect width={art.W} height={art.H} fill="#0E0C2B" />}
      <rect width={art.W} height={art.H} fill={`url(#glow-${uid})`} />
      <g fill="none" stroke={line}>
        {art.orbits.map((o) => (
          <circle key={o.r} cx={art.cx} cy={art.cy} r={o.r} strokeOpacity={o.opacity} strokeWidth={1} strokeDasharray={o.dash} />
        ))}
      </g>
      <g fill="none" strokeLinecap="round">
        <path d={art.pathA} stroke={`url(#arc-a-${uid})`} strokeWidth={26} pathLength={1} strokeDasharray="1" className={drawClass} style={{ ["--arc-length" as string]: 1 }} />
        <path d={art.pathB} stroke={`url(#arc-b-${uid})`} strokeWidth={26} pathLength={1} strokeDasharray="1" className={drawClass} style={{ ["--arc-length" as string]: 1, animationDelay: "180ms" }} />
      </g>
      <g stroke={line} strokeOpacity={ink ? 0.22 : 0.18} strokeWidth={1}>
        {art.nodes.slice(1).map((n, i) => (
          <line key={`l${i}`} x1={art.nodes[i].x} y1={art.nodes[i].y} x2={n.x} y2={n.y} />
        ))}
      </g>
      <g>
        {art.nodes.map((n, i) => (
          <g key={`n${i}`}>
            {n.halo && <circle cx={n.x} cy={n.y} r={n.r * 3.2} fill="none" stroke={ink ? accent.glow : accent.accent} strokeOpacity={0.35} />}
            <circle cx={n.x} cy={n.y} r={n.r} fill={ink ? "#FFFFFF" : accent.accent} fillOpacity={ink ? 0.85 : 0.7} />
          </g>
        ))}
      </g>
    </svg>
  );
}

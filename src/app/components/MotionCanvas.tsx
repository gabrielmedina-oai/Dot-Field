import { useEffect, useRef, useCallback } from "react";

export type Formation = "grid" | "scatter" | "ring" | "rain";

export interface ColorConfig {
  bgColor: string;
  dotColor: string;
  haloColor: string;
  haloEnabled: boolean;
  haloStrength: number;
  haloSize: number;
  paletteEnabled: boolean;
  palette: string[];
}

export interface CanvasParams {
  seed: number;
  dotSize: number;
  sizeVariation: number;
  density: number;
  noise: number;
  spread: number;
  gridSpacing: number;
  gridFit: boolean;
  formation: Formation;
  paused: boolean;
  color: ColorConfig;
}

interface Props extends CanvasParams {
  onFrame?: (frame: number) => void;
}

// ── Seeded RNG ─────────────────────────────────────────────────────────────
function makeRng(seed: number) {
  let s = ((seed ^ 0xdeadbeef) >>> 0) || 1;
  return () => {
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s = (s ^ (s >>> 16)) >>> 0;
    return s / 0x100000000;
  };
}

// ── Deterministic value noise ──────────────────────────────────────────────
function smoothstep(t: number) { return t * t * (3 - 2 * t); }

// Build permutation table with a fixed seed (deterministic, no Math.random)
function buildPerm(): readonly number[] {
  const p = Array.from({ length: 256 }, (_, i) => i);
  let s = 0xf1e2d3c4 >>> 0;
  for (let i = 255; i > 0; i--) {
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s = (s ^ (s >>> 16)) >>> 0;
    const j = s % (i + 1);
    const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
  }
  return Object.freeze([...p, ...p]);
}
const PERM = buildPerm();

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x) & 255, iy = Math.floor(y) & 255;
  const fx = x - Math.floor(x), fy = y - Math.floor(y);
  const ux = smoothstep(fx), uy = smoothstep(fy);
  const h = (xi: number, yi: number) => PERM[(PERM[xi & 255] + yi) & 255] / 255;
  return (
    h(ix, iy)         * (1 - ux) * (1 - uy) +
    h(ix + 1, iy)     * ux       * (1 - uy) +
    h(ix, iy + 1)     * (1 - ux) * uy +
    h(ix + 1, iy + 1) * ux       * uy
  );
}

function fbm(x: number, y: number, oct = 4): number {
  let v = 0, a = 0.5, f = 1, max = 0;
  for (let i = 0; i < oct; i++) {
    v += valueNoise(x * f, y * f) * a;
    max += a; a *= 0.5; f *= 2.07;
  }
  return v / max;
}

// ── Color ──────────────────────────────────────────────────────────────────
function pickColor(cfg: ColorConfig, t: number): string {
  if (!cfg.paletteEnabled || cfg.palette.length === 0) return cfg.dotColor;
  const i = Math.floor(Math.abs(t) * cfg.palette.length) % cfg.palette.length;
  return cfg.palette[i] ?? cfg.dotColor;
}

// ── Primitives ─────────────────────────────────────────────────────────────
function drawDot(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, r: number, alpha: number,
  fill: string, cfg: ColorConfig
) {
  if (r < 0.3 || alpha < 0.01) return;
  if (cfg.haloEnabled && cfg.haloStrength > 0) {
    const hr = r * (1.4 + cfg.haloSize * 2.6);
    ctx.globalAlpha = alpha * cfg.haloStrength * 0.28;
    ctx.fillStyle = cfg.haloColor;
    ctx.beginPath();
    ctx.arc(x, y, hr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = alpha;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// ── GRID ───────────────────────────────────────────────────────────────────
function renderGrid(
  ctx: CanvasRenderingContext2D, W: number, H: number, t: number,
  seed: number, dotSize: number, sizeVar: number,
  density: number, noise: number, gridSpacing: number, gridFit: boolean, cfg: ColorConfig
) {
  if (W <= 0 || H <= 0) return;
  const sp = Math.max(4, gridSpacing * Math.min(W, H) * 0.1);
  if (sp <= 0) return;
  const maxR = dotSize * sp * 0.42;

  let cols: number, rows: number, ox: number, oy: number;

  if (gridFit) {
    // FIT: grid anchors inside the canvas — no dot ever clips an edge.
    // We pad by maxR so the largest possible dot stays fully within bounds.
    const pad = Math.max(maxR, sp * 0.5);
    cols = Math.max(2, Math.floor((W - 2 * pad) / sp) + 1);
    rows = Math.max(2, Math.floor((H - 2 * pad) / sp) + 1);
    // Center the dot field; ox/oy will be >= pad
    ox = (W - (cols - 1) * sp) * 0.5;
    oy = (H - (rows - 1) * sp) * 0.5;
  } else {
    // TILE: grid bleeds to edges — partial dots at border, infinite-field feel
    cols = Math.ceil(W / sp) + 2;
    rows = Math.ceil(H / sp) + 2;
    ox = (W - (cols - 1) * sp) * 0.5;
    oy = (H - (rows - 1) * sp) * 0.5;
  }

  const freq  = noise * 0.11 + 0.016;
  const spd   = noise * 0.20 + 0.035;
  const so    = ((seed * 7 + 13) % 997) * 0.01;
  const total = cols * rows;

  for (let ci = 0; ci < cols; ci++) {
    for (let ri = 0; ri < rows; ri++) {
      const px = ci * sp + ox;
      const py = ri * sp + oy;
      const n  = fbm(px * freq + so + t * spd * 0.25, py * freq + so * 1.3 + t * spd * 0.18);
      const threshold = 0.26 + (1 - density) * 0.34;
      const raw    = Math.max(0, (n - threshold) / (1 - threshold));
      const curved = Math.pow(raw, 1.5 - sizeVar * 0.9);
      const minR   = maxR * (0.04 + (1 - sizeVar) * 0.22);
      const r      = minR + curved * (maxR - minR);
      if (r < 0.4) continue;
      const palT = (ci * rows + ri) / total;
      drawDot(ctx, px, py, r, 1, pickColor(cfg, palT), cfg);
    }
  }
  ctx.globalAlpha = 1;
}

// ── SCATTER ────────────────────────────────────────────────────────────────
function renderScatter(
  ctx: CanvasRenderingContext2D, W: number, H: number, t: number,
  seed: number, dotSize: number, sizeVar: number,
  noise: number, spread: number, cfg: ColorConfig,
  buf: Float32Array
) {
  if (W <= 0 || H <= 0) return;
  if (buf.length === 0) return;
  const count     = buf.length / 5;
  const maxR      = dotSize * Math.min(W, H) * 0.028;
  const driftFreq = 0.0016 + noise * 0.003;
  const driftSpd  = 0.035 + noise * 0.11;
  const so        = ((seed * 7 + 13) % 997) * 0.01;

  for (let i = 0; i < count; i++) {
    const b = i * 5;
    const bx = buf[b] * W, by = buf[b + 1] * H;
    const baseSize    = buf[b + 2];
    const phase       = buf[b + 3];
    const twinkleSpd  = buf[b + 4];

    const dx = (fbm(bx * driftFreq + so + t * driftSpd, by * driftFreq) - 0.5) * spread * 110;
    const dy = (fbm(bx * driftFreq, by * driftFreq + so * 1.7 + t * driftSpd) - 0.5) * spread * 110;
    const px = ((bx + dx) % W + W) % W;
    const py = ((by + dy) % H + H) % H;

    const twinkle = Math.sin(t * twinkleSpd + phase) * 0.5 + 0.5;
    const sizeN   = baseSize < 0.7 ? baseSize * 0.4 : 0.28 + (baseSize - 0.7) * 2.4;
    const r       = (sizeN * (0.3 + sizeVar * 0.7) + (1 - sizeVar) * 0.12) * maxR * (0.55 + twinkle * 0.45);
    if (r < 0.3) continue;
    drawDot(ctx, px, py, r, 1, pickColor(cfg, i / count), cfg);
  }
  ctx.globalAlpha = 1;
}

// ── RING ───────────────────────────────────────────────────────────────────
function renderRing(
  ctx: CanvasRenderingContext2D, W: number, H: number, t: number,
  seed: number, dotSize: number, sizeVar: number,
  density: number, noise: number, spread: number, cfg: ColorConfig
) {
  if (W <= 0 || H <= 0) return;
  const cx        = W * 0.5, cy = H * 0.5;
  const dim       = Math.min(W, H);
  const baseR     = dim * (0.18 + spread * 0.24);
  const ringW     = dim * (0.025 + spread * 0.14);
  const count     = Math.floor(60 + density * 520);
  const maxDot    = dotSize * dim * 0.022;
  const rotSpd    = 0.012 + noise * 0.038;
  const nFreq     = 0.045 + noise * 0.085;
  const nSpd      = 0.055 + noise * 0.17;
  const so        = ((seed * 11 + 7) % 997) * 0.001;
  const rand      = makeRng(seed);

  for (let i = 0; i < count; i++) {
    const baseAngle = rand() * Math.PI * 2;
    const aJitter   = (rand() - 0.5) * 0.2;
    const angle     = baseAngle + aJitter + t * rotSpd * (0.75 + rand() * 0.5);
    const u         = rand() + rand() - 1; // triangular dist, -1 to 1
    const ringPos   = baseR + u * ringW;
    const px        = cx + Math.cos(angle) * ringPos;
    const py        = cy + Math.sin(angle) * ringPos;

    const n      = fbm(Math.cos(angle) * nFreq * 4 + so + t * nSpd * 0.2,
                       Math.sin(angle) * nFreq * 4 + so * 1.4 + t * nSpd * 0.15, 3);
    const curved = Math.pow(Math.max(0, n), 1.2);
    const edge   = Math.max(0, 1 - Math.abs(u));
    const dotR   = (maxDot * 0.05 + curved * (maxDot - maxDot * 0.05) * (0.28 + sizeVar * 0.72)) * (0.35 + edge * 0.65);
    if (dotR < 0.3) continue;

    const palT = ((angle / (Math.PI * 2)) % 1 + 1) % 1;
    drawDot(ctx, px, py, dotR, 1, pickColor(cfg, palT), cfg);
  }
  ctx.globalAlpha = 1;
}

// ── RAIN ───────────────────────────────────────────────────────────────────
// Stride 3: [y, speed, size] per drop — dots only, no diamonds
function renderRain(
  ctx: CanvasRenderingContext2D, W: number, H: number, t: number,
  seed: number, dotSize: number, sizeVar: number,
  density: number, noise: number, cfg: ColorConfig,
  buf: Float32Array
) {
  if (W <= 0 || H <= 0) return;
  const colCount    = Math.floor(6 + density * 28);
  const maxR        = dotSize * Math.min(W, H) * 0.018;
  const colSpacing  = W / colCount;
  const itemsPerCol = Math.floor(buf.length / colCount / 3);
  const fallSpd     = 16 + noise * 55;

  for (let ci = 0; ci < colCount; ci++) {
    const rand   = makeRng(seed + ci * 31);
    const xJit   = (rand() - 0.5) * colSpacing * 0.22;
    const px     = (ci + 0.5) * colSpacing + xJit;
    const palT   = ci / colCount;

    for (let di = 0; di < itemsPerCol; di++) {
      const idx = (ci * itemsPerCol + di) * 3;
      if (idx + 2 >= buf.length) continue;

      const initY    = buf[idx];
      const spdMult  = buf[idx + 1];
      const sizeFrac = buf[idx + 2];

      const py    = ((initY + t * fallSpd * spdMult) % (H + 80) + H + 80) % (H + 80) - 40;
      const r     = maxR * (0.1 + sizeFrac * (0.2 + sizeVar * 0.7));
      if (r < 0.3) continue;

      const fadeIn  = Math.min(1, py / (H * 0.07));
      const fadeOut = 1 - Math.max(0, (py - H * 0.9) / (H * 0.1));
      const alpha   = Math.max(0, Math.min(1, fadeIn * fadeOut));
      if (alpha < 0.04) continue;

      drawDot(ctx, px, py, r, alpha, pickColor(cfg, palT), cfg);
    }
  }
  ctx.globalAlpha = 1;
}

// ── Component ──────────────────────────────────────────────────────────────
export function MotionCanvas({
  seed, dotSize, sizeVariation, density, noise, spread, gridSpacing, gridFit,
  formation, paused, color, onFrame,
}: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const animRef    = useRef<number>(0);
  const frameRef   = useRef(0);
  const pausedRef  = useRef(paused);
  const paramsRef  = useRef({ seed, dotSize, sizeVariation, density, noise, spread, gridSpacing, gridFit, formation, color });
  const bufsRef    = useRef<{ scatter: Float32Array; drops: Float32Array; key: string } | null>(null);

  pausedRef.current = paused;
  paramsRef.current = { seed, dotSize, sizeVariation, density, noise, spread, gridSpacing, gridFit, formation, color };

  const rebuildBufs = useCallback((H: number, seed: number, density: number) => {
    const rand = makeRng(seed);

    const scatterCount = Math.floor(25 + density * 350);
    const scatter = new Float32Array(scatterCount * 5);
    for (let i = 0; i < scatterCount; i++) {
      scatter[i * 5 + 0] = rand();
      scatter[i * 5 + 1] = rand();
      scatter[i * 5 + 2] = rand() * rand();
      scatter[i * 5 + 3] = rand() * Math.PI * 2;
      scatter[i * 5 + 4] = 0.4 + rand() * 1.6;
    }

    // Stride 3: [initY, speedMult, sizeFrac] — no isDiamond
    const colCount    = Math.floor(6 + density * 28);
    const itemsPerCol = Math.floor(4 + density * 22);
    const drops = new Float32Array(colCount * itemsPerCol * 3);
    for (let i = 0; i < colCount * itemsPerCol; i++) {
      drops[i * 3 + 0] = rand() * (H + 80);
      drops[i * 3 + 1] = 0.25 + rand() * 0.75;
      drops[i * 3 + 2] = rand() * rand();
    }

    bufsRef.current = { scatter, drops, key: `${seed}-${density}` };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const W = canvas.offsetWidth || 1;
      const H = canvas.offsetHeight || 1;
      canvas.width  = Math.round(W * window.devicePixelRatio);
      canvas.height = Math.round(H * window.devicePixelRatio);
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      const p = paramsRef.current;
      rebuildBufs(H, p.seed, p.density);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = () => {
      if (pausedRef.current) { animRef.current = requestAnimationFrame(draw); return; }

      const W = canvas.offsetWidth;
      const H = canvas.offsetHeight;
      if (W <= 0 || H <= 0) { animRef.current = requestAnimationFrame(draw); return; }

      const t    = frameRef.current * 0.016;
      const p    = paramsRef.current;
      const bufs = bufsRef.current;
      const key  = `${p.seed}-${p.density}`;

      if (!bufs || bufs.key !== key) {
        rebuildBufs(H, p.seed, p.density);
        animRef.current = requestAnimationFrame(draw);
        return;
      }

      // Clear with background color
      ctx.globalAlpha = 1;
      ctx.fillStyle = p.color.bgColor || "#000000";
      ctx.fillRect(0, 0, W, H);

      if (p.formation === "grid") {
        renderGrid(ctx, W, H, t, p.seed, p.dotSize, p.sizeVariation, p.density, p.noise, p.gridSpacing, p.gridFit, p.color);
      } else if (p.formation === "scatter") {
        renderScatter(ctx, W, H, t, p.seed, p.dotSize, p.sizeVariation, p.noise, p.spread, p.color, bufs.scatter);
      } else if (p.formation === "ring") {
        renderRing(ctx, W, H, t, p.seed, p.dotSize, p.sizeVariation, p.density, p.noise, p.spread, p.color);
      } else if (p.formation === "rain") {
        renderRain(ctx, W, H, t, p.seed, p.dotSize, p.sizeVariation, p.density, p.noise, p.color, bufs.drops);
      }

      frameRef.current++;
      onFrame?.(frameRef.current);
      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(animRef.current); ro.disconnect(); };
  }, [rebuildBufs, onFrame]);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: "block", width: "100%", height: "100%" }}
    />
  );
}

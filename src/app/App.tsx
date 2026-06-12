import { useState, useCallback, useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { MotionCanvas, Formation, ColorConfig } from "./components/MotionCanvas";

// ── Types ───────────────────────────────────────────────────────────────────

interface Scene {
  id: string;
  name: string;
  formation: Formation;
  seed: number;
  dotSize: number;
  sizeVariation: number;
  density: number;
  noise: number;
  spread: number;
  gridSpacing: number;
}

type ViewportPreset = "free" | "1:1" | "4:5" | "9:16" | "16:9" | "4:3" | "custom";

interface Viewport {
  preset: ViewportPreset;
  customW: number;
  customH: number;
}

// ── Data ────────────────────────────────────────────────────────────────────

const SCENES: Scene[] = [
  { id: "signal-snow",   name: "Signal Snow",   formation: "grid",    seed: 0x221133, dotSize: 0.58, sizeVariation: 0.82, density: 0.64, noise: 0.52, spread: 0.60, gridSpacing: 0.38 },
  { id: "star-bloom",    name: "Star Bloom",    formation: "scatter", seed: 0xb70440, dotSize: 0.70, sizeVariation: 0.88, density: 0.24, noise: 0.30, spread: 0.50, gridSpacing: 0.38 },
  { id: "orbit-dust",    name: "Orbit Dust",    formation: "ring",    seed: 0x88f2a1, dotSize: 0.46, sizeVariation: 0.76, density: 0.52, noise: 0.42, spread: 0.58, gridSpacing: 0.38 },
  { id: "shard-drift",   name: "Shard Drift",   formation: "rain",    seed: 0x3fa2cc, dotSize: 0.44, sizeVariation: 0.62, density: 0.50, noise: 0.48, spread: 0.40, gridSpacing: 0.38 },
  { id: "opening-study", name: "Opening Study", formation: "ring",    seed: 0xb70441, dotSize: 0.36, sizeVariation: 0.72, density: 0.78, noise: 0.50, spread: 0.68, gridSpacing: 0.38 },
  { id: "sparse-field",  name: "Sparse Field",  formation: "grid",    seed: 0xaabbcc, dotSize: 0.45, sizeVariation: 0.95, density: 0.38, noise: 0.72, spread: 0.5,  gridSpacing: 0.62 },
  { id: "deep-cluster",  name: "Deep Cluster",  formation: "scatter", seed: 0x334455, dotSize: 0.55, sizeVariation: 0.92, density: 0.72, noise: 0.22, spread: 0.28, gridSpacing: 0.38 },
  { id: "fine-rain",     name: "Fine Rain",     formation: "rain",    seed: 0x99aabb, dotSize: 0.28, sizeVariation: 0.55, density: 0.80, noise: 0.35, spread: 0.4,  gridSpacing: 0.38 },
  { id: "double-ring",   name: "Double Ring",   formation: "ring",    seed: 0x556677, dotSize: 0.32, sizeVariation: 0.88, density: 0.90, noise: 0.68, spread: 0.42, gridSpacing: 0.38 },
  { id: "micro-grid",    name: "Micro Grid",    formation: "grid",    seed: 0x112233, dotSize: 0.38, sizeVariation: 0.70, density: 0.85, noise: 0.40, spread: 0.5,  gridSpacing: 0.18 },
];

const MODE_LABEL: Record<Formation, string> = {
  grid: "GRID", scatter: "SCATTER", ring: "RING", rain: "RAIN",
};

const VP_PRESETS: { id: ViewportPreset; label: string; ratio: [number, number] | null }[] = [
  { id: "free",   label: "FREE",  ratio: null },
  { id: "1:1",    label: "1:1",   ratio: [1, 1] },
  { id: "4:5",    label: "4:5",   ratio: [4, 5] },
  { id: "9:16",   label: "9:16",  ratio: [9, 16] },
  { id: "16:9",   label: "16:9",  ratio: [16, 9] },
  { id: "4:3",    label: "4:3",   ratio: [4, 3] },
];

const DEFAULT_COLOR: ColorConfig = {
  bgColor: "#000000",
  dotColor: "#ffffff",
  haloColor: "#ffffff",
  haloEnabled: true,
  haloStrength: 0.55,
  haloSize: 0.35,
  paletteEnabled: false,
  palette: ["#ffffff", "#cccccc", "#888888", "#444444"],
};

// ── URL state ────────────────────────────────────────────────────────────────

function n2(v: number) { return v.toFixed(2); }
function b(v: boolean) { return v ? "1" : "0"; }
function stripHash(c: string) { return c.replace(/^#/, ""); }
function addHash(c: string) { return c.startsWith("#") ? c : `#${c}`; }

function encodeState(
  sceneId: string,
  formation: Formation,
  params: ReturnType<typeof sceneToParams>,
  color: ColorConfig,
  viewport: Viewport,
) {
  const p = new URLSearchParams();
  p.set("sc", sceneId);
  p.set("f",  formation);
  p.set("sd", params.seed.toString(16).toUpperCase().padStart(6, "0"));
  p.set("ds", n2(params.dotSize));
  p.set("sv", n2(params.sizeVariation));
  p.set("dn", n2(params.density));
  p.set("ns", n2(params.noise));
  p.set("sp", n2(params.spread));
  p.set("gs", n2(params.gridSpacing));
  p.set("gf", b(params.gridFit));
  p.set("bg", stripHash(color.bgColor));
  p.set("dc", stripHash(color.dotColor));
  p.set("hc", stripHash(color.haloColor));
  p.set("he", b(color.haloEnabled));
  p.set("hs", n2(color.haloStrength));
  p.set("hz", n2(color.haloSize));
  p.set("pe", b(color.paletteEnabled));
  p.set("pal", color.palette.map(stripHash).join(","));
  p.set("vp", viewport.preset);
  p.set("vw", viewport.customW.toString());
  p.set("vh", viewport.customH.toString());
  return p;
}

interface DecodedState {
  sceneId: string;
  formation: Formation;
  params: ReturnType<typeof sceneToParams>;
  color: ColorConfig;
  viewport: Viewport;
}

function decodeState(p: URLSearchParams): DecodedState | null {
  if (!p.has("f")) return null;
  try {
    const f = p.get("f") as Formation;
    if (!["grid","scatter","ring","rain"].includes(f)) return null;
    const seed = parseInt(p.get("sd") ?? "0", 16) || 0;
    const vp   = (p.get("vp") ?? "free") as ViewportPreset;
    const palRaw = p.get("pal") ?? "";
    const palette = palRaw ? palRaw.split(",").map(addHash) : DEFAULT_COLOR.palette;
    return {
      sceneId:   p.get("sc") ?? SCENES[0].id,
      formation: f,
      params: {
        seed,
        dotSize:       parseFloat(p.get("ds") ?? "0.5"),
        sizeVariation: parseFloat(p.get("sv") ?? "0.8"),
        density:       parseFloat(p.get("dn") ?? "0.5"),
        noise:         parseFloat(p.get("ns") ?? "0.5"),
        spread:        parseFloat(p.get("sp") ?? "0.5"),
        gridSpacing:   parseFloat(p.get("gs") ?? "0.38"),
        gridFit:       p.get("gf") === "1",
      },
      color: {
        bgColor:        addHash(p.get("bg") ?? "000000"),
        dotColor:       addHash(p.get("dc") ?? "ffffff"),
        haloColor:      addHash(p.get("hc") ?? "ffffff"),
        haloEnabled:    p.get("he") !== "0",
        haloStrength:   parseFloat(p.get("hs") ?? "0.55"),
        haloSize:       parseFloat(p.get("hz") ?? "0.35"),
        paletteEnabled: p.get("pe") === "1",
        palette,
      },
      viewport: {
        preset:  vp,
        customW: parseInt(p.get("vw") ?? "1080") || 1080,
        customH: parseInt(p.get("vh") ?? "1920") || 1920,
      },
    };
  } catch {
    return null;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function seedToHex(n: number) {
  return n.toString(16).toUpperCase().padStart(6, "0");
}
function hexToSeed(s: string) {
  const n = parseInt(s.replace(/[^0-9a-fA-F]/g, ""), 16);
  return isNaN(n) ? 0 : n;
}

function getCanvasWrapStyle(vp: Viewport): CSSProperties {
  if (vp.preset === "free") return { width: "100%", height: "100%" };
  if (vp.preset === "custom") {
    if (vp.customW > 0 && vp.customH > 0) {
      return { aspectRatio: `${vp.customW} / ${vp.customH}`, maxWidth: "100%", maxHeight: "100%" };
    }
    return { width: "100%", height: "100%" };
  }
  const found = VP_PRESETS.find(p => p.id === vp.preset);
  if (!found || !found.ratio) return { width: "100%", height: "100%" };
  return { aspectRatio: `${found.ratio[0]} / ${found.ratio[1]}`, maxWidth: "100%", maxHeight: "100%" };
}

function sceneToParams(s: Scene) {
  return {
    seed: s.seed,
    dotSize: s.dotSize,
    sizeVariation: s.sizeVariation,
    density: s.density,
    noise: s.noise,
    spread: s.spread,
    gridSpacing: s.gridSpacing,
    gridFit: false,
  };
}

// ── UI primitives ───────────────────────────────────────────────────────────

function Label({ children }: { children: string }) {
  return (
    <div className="text-[9px] uppercase tracking-wider mb-[5px]" style={{ opacity: 0.32 }}>
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-0">{children}</div>;
}

function Slider({
  label, value, min = 0, max = 1, step = 0.01, onChange,
}: {
  label: string; value: number; min?: number; max?: number;
  step?: number; onChange: (v: number) => void;
}) {
  const safe    = (typeof value === "number" && !isNaN(value)) ? value : 0;
  const clamped = Math.min(max, Math.max(min, safe));
  const [text, setText] = useState(clamped.toFixed(2));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(clamped.toFixed(2));
  }, [clamped]);

  return (
    <div className="flex items-center w-full" style={{ height: 20 }}>
      <input
        type="number"
        value={text}
        step={step} min={min} max={max}
        onChange={e => {
          setText(e.target.value);
          const v = parseFloat(e.target.value);
          if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; setText(clamped.toFixed(2)); }}
        className="border border-black bg-white text-[10px] px-[3px] outline-none shrink-0"
        style={{ width: 40, height: 18, fontFamily: "inherit" }}
      />
      <div className="relative flex-1 mx-[5px]" style={{ height: 18 }}>
        <input
          type="range" min={min} max={max} step={step} value={clamped}
          onChange={e => onChange(parseFloat(e.target.value))}
          className="w-full absolute top-1/2 -translate-y-1/2"
          style={{ appearance: "none", height: 1, background: "#000", outline: "none", cursor: "crosshair" }}
        />
      </div>
      <span
        className="text-[9px] uppercase tracking-wider text-right whitespace-nowrap shrink-0"
        style={{ width: 64 }}
      >
        {label}
      </span>
    </div>
  );
}

function Swatch({ color, onChange, label }: { color: string; onChange: (c: string) => void; label: string }) {
  return (
    <div className="flex flex-col items-center gap-[3px]">
      <div className="relative border border-black" style={{ width: 22, height: 22 }}>
        <input
          type="color" value={color}
          onChange={e => onChange(e.target.value)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" }}
        />
        <div style={{ width: "100%", height: "100%", background: color }} />
      </div>
      <span className="text-[8px] uppercase" style={{ opacity: 0.4 }}>{label}</span>
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="text-[8px] uppercase border border-black px-[5px] shrink-0"
      style={{ height: 15, background: value ? "#000" : "#fff", color: value ? "#fff" : "#000" }}
    >
      {value ? "ON" : "OFF"}
    </button>
  );
}

function Section({ children, border = true }: { children: React.ReactNode; border?: boolean }) {
  return (
    <div
      className="px-3 py-[10px] shrink-0"
      style={{ borderBottom: border ? "1px solid #000" : "none" }}
    >
      {children}
    </div>
  );
}

// ── Copy-link toast ──────────────────────────────────────────────────────────

function CopyLinkButton({ getParams }: { getParams: () => URLSearchParams }) {
  const [state, setState] = useState<"idle" | "copied">("idle");

  const copy = () => {
    const url = new URL(window.location.href);
    url.search = getParams().toString();
    navigator.clipboard.writeText(url.toString()).then(() => {
      setState("copied");
      setTimeout(() => setState("idle"), 1800);
    });
  };

  return (
    <button
      onClick={copy}
      className="text-[10px] uppercase border border-black px-3 hover:bg-black hover:text-white"
      style={{
        height: 18,
        borderRight: "none",
        background: state === "copied" ? "#000" : "#fff",
        color:      state === "copied" ? "#fff" : "#000",
      }}
    >
      {state === "copied" ? "COPIED" : "SHARE"}
    </button>
  );
}

// ── App ─────────────────────────────────────────────────────────────────────

function initFromUrl(): {
  scene: Scene; formation: Formation;
  params: ReturnType<typeof sceneToParams>;
  seedHex: string; color: ColorConfig; viewport: Viewport;
} {
  const decoded = decodeState(new URLSearchParams(window.location.search));
  if (decoded) {
    const scene = SCENES.find(s => s.id === decoded.sceneId) ?? SCENES[0];
    return {
      scene,
      formation: decoded.formation,
      params:    decoded.params,
      seedHex:   seedToHex(decoded.params.seed),
      color:     decoded.color,
      viewport:  decoded.viewport,
    };
  }
  const first = SCENES[0];
  return {
    scene:    first,
    formation: first.formation,
    params:   sceneToParams(first),
    seedHex:  seedToHex(first.seed),
    color:    { ...DEFAULT_COLOR },
    viewport: { preset: "free", customW: 1080, customH: 1920 },
  };
}

export default function App() {
  const init = useRef(initFromUrl()).current;

  const [scene,     setScene]     = useState<Scene>(init.scene);
  const [formation, setFormation] = useState<Formation>(init.formation);
  const [params,    setParams]    = useState(init.params);
  const [seedHex,   setSeedHex]   = useState(init.seedHex);
  const [paused,    setPaused]    = useState(false);
  const [frame,     setFrame]     = useState(0);
  const [color,     setColor]     = useState<ColorConfig>(init.color);
  const [viewport,  setViewport]  = useState<Viewport>(init.viewport);
  const [exported,  setExported]  = useState(false);
  const [svgExported, setSvgExported] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const appRef = useRef<HTMLDivElement>(null);

  // ── URL sync (debounced, replaceState so no history spam) ──────────────────
  const urlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (urlTimerRef.current) clearTimeout(urlTimerRef.current);
    urlTimerRef.current = setTimeout(() => {
      const p = encodeState(scene.id, formation, params, color, viewport);
      window.history.replaceState(null, "", `?${p.toString()}`);
    }, 400);
    return () => { if (urlTimerRef.current) clearTimeout(urlTimerRef.current); };
  }, [scene.id, formation, params, color, viewport]);

  // ── Fullscreen ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      appRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  // ── Param helpers ──────────────────────────────────────────────────────────
  const setP = (key: keyof typeof params) => (v: number) =>
    setParams(p => ({ ...p, [key]: isNaN(v) ? p[key] : v }));

  const setBg      = (v: string) => setColor(c => ({ ...c, bgColor: v }));
  const setDot     = (v: string) => setColor(c => ({ ...c, dotColor: v }));
  const setHaloCl  = (v: string) => setColor(c => ({ ...c, haloColor: v }));
  const setHaloOn  = (v: boolean) => setColor(c => ({ ...c, haloEnabled: v }));
  const setHaloStr = (v: number) => setColor(c => ({ ...c, haloStrength: v }));
  const setHaloSz  = (v: number) => setColor(c => ({ ...c, haloSize: v }));
  const setPalOn   = (v: boolean) => setColor(c => ({ ...c, paletteEnabled: v }));
  const setPalCol  = (i: number, v: string) =>
    setColor(c => { const p = [...c.palette]; p[i] = v; return { ...c, palette: p }; });
  const addPalCol  = () => setColor(c => ({ ...c, palette: [...c.palette, "#ffffff"] }));
  const rmPalCol   = (i: number) =>
    setColor(c => ({ ...c, palette: c.palette.filter((_, j) => j !== i) }));

  const handleSeedHex = (s: string) => {
    setSeedHex(s);
    const n = hexToSeed(s);
    if (!isNaN(n)) setParams(p => ({ ...p, seed: n }));
  };

  const newSeed = () => {
    const n = Math.floor(Math.random() * 0xffffff);
    setSeedHex(seedToHex(n));
    setParams(p => ({ ...p, seed: n }));
  };

  const loadScene = (s: Scene) => {
    setScene(s);
    setFormation(s.formation);
    setParams(sceneToParams(s));
    setSeedHex(seedToHex(s.seed));
  };

  const reset = () => loadScene(scene);

  const exportPng = () => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `dots_${seedHex}_f${frame}.png`;
    a.click();
    setExported(true);
    setTimeout(() => setExported(false), 1800);
  };

  const exportSvg = () => {
    const canvas = document.querySelector("canvas") as HTMLCanvasElement | null;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(canvas.width / dpr);
    const H = Math.round(canvas.height / dpr);
    const dataUrl = canvas.toDataURL("image/png");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><image href="${dataUrl}" width="${W}" height="${H}"/></svg>`;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dots_${seedHex}_f${frame}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSvgExported(true);
    setTimeout(() => setSvgExported(false), 1800);
  };

  const getShareParams = useCallback(
    () => encodeState(scene.id, formation, params, color, viewport),
    [scene.id, formation, params, color, viewport],
  );

  const handleFrame = useCallback((f: number) => setFrame(f), []);

  const isGrid      = formation === "grid";
  const hasSpread   = formation === "scatter" || formation === "ring";
  const canvasWrapStyle = getCanvasWrapStyle(viewport);
  const isConstrained   = viewport.preset !== "free";

  return (
    <div
      ref={appRef}
      className="w-full h-full flex flex-col bg-white text-black overflow-hidden"
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "#fff",
        color: "#000",
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
      }}
    >
      {/* ── TOP BAR ── */}
      <div
        className="flex items-center justify-between px-3 border-b border-black shrink-0"
        style={{ height: 28 }}
      >
        <span className="text-[10px] uppercase tracking-widest" style={{ opacity: 0.65 }}>
          Dot Field
        </span>
        <div className="flex items-center">
          <button
            onClick={() => setPaused(p => !p)}
            className="text-[10px] uppercase border border-black px-3 hover:bg-black hover:text-white shrink-0"
            style={{ height: 18, borderRight: "none", background: paused ? "#000" : "#fff", color: paused ? "#fff" : "#000" }}
          >
            {paused ? "RESUME" : "PAUSE"}
          </button>
          <button
            onClick={newSeed}
            className="text-[10px] uppercase border border-black px-3 hover:bg-black hover:text-white"
            style={{ height: 18, borderRight: "none" }}
          >
            NEW SEED
          </button>
          <CopyLinkButton getParams={getShareParams} />
          <button
            onClick={exportPng}
            className="text-[10px] uppercase border border-black px-3 hover:bg-black hover:text-white"
            style={{
              height: 18, borderRight: "none",
              background: exported ? "#000" : "#fff",
              color:      exported ? "#fff" : "#000",
            }}
          >
            {exported ? "SAVED" : "PNG"}
          </button>
          <button
            onClick={exportSvg}
            className="text-[10px] uppercase border border-black px-3 hover:bg-black hover:text-white"
            style={{
              height: 18, borderRight: "none",
              background: svgExported ? "#000" : "#fff",
              color:      svgExported ? "#fff" : "#000",
            }}
          >
            {svgExported ? "SAVED" : "SVG"}
          </button>
          <button
            onClick={toggleFullscreen}
            className="text-[10px] uppercase border border-black px-3 hover:bg-black hover:text-white"
            style={{
              height: 18, borderRight: "none",
              background: fullscreen ? "#000" : "#fff",
              color:      fullscreen ? "#fff" : "#000",
            }}
          >
            {fullscreen ? "EXIT FS" : "FULL"}
          </button>
          <button
            className="text-[10px] uppercase border border-black px-3"
            style={{ height: 18, background: "#000", color: "#fff", opacity: 0.4, cursor: "not-allowed" }}
          >
            RECORD
          </button>
        </div>
      </div>

      {/* ── BODY ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT: SCENES + FORMAT ── */}
        <div
          className="flex flex-col border-r border-black shrink-0 overflow-hidden"
          style={{ width: 148 }}
        >
          <div className="flex items-center px-3 border-b border-black shrink-0" style={{ height: 22 }}>
            <span className="text-[10px] uppercase tracking-wider">Scenes</span>
          </div>

          <div className="flex flex-col overflow-y-auto flex-1">
            {SCENES.map(s => {
              const active = scene.id === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => loadScene(s)}
                  className="text-left px-3 py-[6px] border-b border-black shrink-0"
                  style={{ background: active ? "#000" : "transparent", color: active ? "#fff" : "#000" }}
                >
                  <div className="text-[10px] uppercase leading-tight">{s.name}</div>
                  <div className="text-[9px] mt-[2px]" style={{ opacity: active ? 0.45 : 0.32 }}>
                    {MODE_LABEL[s.formation]}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Format */}
          <div className="border-t border-black shrink-0">
            <div className="flex items-center px-3 border-b border-black" style={{ height: 22 }}>
              <span className="text-[10px] uppercase tracking-wider">Format</span>
            </div>
            <div className="px-3 py-2">
              <div className="grid gap-0 mb-[6px]" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                {VP_PRESETS.map((p, i) => {
                  const active = viewport.preset === p.id;
                  const isLastInRow = (i + 1) % 3 === 0;
                  const isFirstRow  = i < 3;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setViewport(vp => ({ ...vp, preset: p.id }))}
                      className="text-[8px] uppercase border border-black py-[3px]"
                      style={{
                        background: active ? "#000" : "#fff",
                        color: active ? "#fff" : "#000",
                        borderRight:  !isLastInRow ? "none" : undefined,
                        borderBottom: isFirstRow   ? "none" : undefined,
                      }}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => setViewport(vp => ({ ...vp, preset: "custom" }))}
                className="w-full text-[8px] uppercase border border-black py-[3px] mb-[6px]"
                style={{
                  background: viewport.preset === "custom" ? "#000" : "#fff",
                  color:      viewport.preset === "custom" ? "#fff" : "#000",
                }}
              >
                Custom px
              </button>
              {viewport.preset === "custom" && (
                <div className="flex items-center gap-1">
                  <input
                    type="number" value={viewport.customW} min={1} max={9999}
                    onChange={e => setViewport(vp => ({ ...vp, customW: parseInt(e.target.value) || 1 }))}
                    className="border border-black text-[9px] w-full px-1 outline-none"
                    style={{ height: 18, fontFamily: "inherit" }}
                  />
                  <span className="text-[9px] shrink-0" style={{ opacity: 0.4 }}>×</span>
                  <input
                    type="number" value={viewport.customH} min={1} max={9999}
                    onChange={e => setViewport(vp => ({ ...vp, customH: parseInt(e.target.value) || 1 }))}
                    className="border border-black text-[9px] w-full px-1 outline-none"
                    style={{ height: 18, fontFamily: "inherit" }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── CENTER: CANVAS ── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div
            className="flex items-center justify-between px-3 border-b border-black shrink-0"
            style={{ height: 22 }}
          >
            <span className="text-[10px] uppercase">
              {scene.name}
              <span style={{ opacity: 0.35 }}> / </span>
              {MODE_LABEL[formation]}
            </span>
            <div className="flex items-center gap-3">
              <span className="text-[9px]" style={{ opacity: 0.22 }}>0x{seedHex}</span>
              <span className="text-[9px]" style={{ opacity: 0.18 }}>F:{frame}</span>
            </div>
          </div>

          <div
            className="flex-1 flex items-center justify-center overflow-hidden"
            style={{ background: isConstrained ? "#111" : color.bgColor }}
          >
            <div style={{ ...canvasWrapStyle, position: "relative" }}>
              <MotionCanvas
                seed={params.seed}
                dotSize={params.dotSize}
                sizeVariation={params.sizeVariation}
                density={params.density}
                noise={params.noise}
                spread={params.spread}
                gridSpacing={params.gridSpacing}
                gridFit={params.gridFit}
                formation={formation}
                paused={paused}
                color={color}
                onFrame={handleFrame}
              />
            </div>
          </div>

          <div
            className="flex items-center px-3 border-t border-black shrink-0"
            style={{ height: 20 }}
          >
            {isConstrained && (
              <span className="text-[9px] uppercase" style={{ opacity: 0.25 }}>
                {viewport.preset === "custom"
                  ? `${viewport.customW} × ${viewport.customH}`
                  : viewport.preset}
              </span>
            )}
          </div>
        </div>

        {/* ── RIGHT: INSPECTOR ── */}
        <div
          className="flex flex-col border-l border-black shrink-0 overflow-y-auto"
          style={{ width: 216 }}
        >
          <div
            className="flex items-center justify-between px-3 border-b border-black shrink-0"
            style={{ height: 22 }}
          >
            <span className="text-[10px] uppercase tracking-wider">Inspector</span>
            <button
              onClick={reset}
              className="text-[9px] uppercase hover:underline"
              style={{ opacity: 0.38 }}
            >
              Reset
            </button>
          </div>

          {/* Mode */}
          <Section>
            <Label>Mode</Label>
            <div className="grid grid-cols-2 gap-0">
              {(["grid", "scatter", "ring", "rain"] as Formation[]).map((f, i) => (
                <button
                  key={f}
                  onClick={() => setFormation(f)}
                  className="text-[9px] uppercase py-[3px] px-2 border border-black"
                  style={{
                    background: formation === f ? "#000" : "#fff",
                    color:      formation === f ? "#fff" : "#000",
                    borderRight:  i % 2 === 0 ? "none" : undefined,
                    borderBottom: i < 2        ? "none" : undefined,
                  }}
                >
                  {MODE_LABEL[f]}
                </button>
              ))}
            </div>
          </Section>

          {/* Seed */}
          <Section>
            <Label>Seed</Label>
            <Row>
              <span className="text-[10px] shrink-0 mr-[3px]" style={{ opacity: 0.32 }}>0x</span>
              <input
                type="text" value={seedHex} maxLength={6}
                onChange={e => handleSeedHex(e.target.value)}
                className="border border-black text-[10px] px-2 outline-none flex-1 uppercase"
                style={{ height: 20, fontFamily: "inherit" }}
              />
              <button
                onClick={newSeed}
                className="text-[9px] uppercase border border-black px-2 ml-1 hover:bg-black hover:text-white shrink-0"
                style={{ height: 20 }}
              >
                RND
              </button>
            </Row>
          </Section>

          {/* Color */}
          <Section>
            <Label>Color</Label>
            <div className="flex items-end gap-3 mb-3">
              <Swatch color={color.bgColor}   onChange={setBg}     label="BG"   />
              <Swatch color={color.dotColor}  onChange={setDot}    label="Dot"  />
              <Swatch color={color.haloColor} onChange={setHaloCl} label="Halo" />
            </div>
            <div className="flex items-center justify-between mb-[6px]">
              <span className="text-[9px] uppercase" style={{ opacity: 0.5 }}>Palette</span>
              <Toggle value={color.paletteEnabled} onChange={setPalOn} />
            </div>
            {color.paletteEnabled && (
              <div className="flex flex-wrap gap-[4px] mt-[5px]">
                {color.palette.map((c, i) => (
                  <div key={i} className="relative group" style={{ lineHeight: 0 }}>
                    <div className="relative border border-black" style={{ width: 20, height: 20 }}>
                      <input
                        type="color" value={c}
                        onChange={e => setPalCol(i, e.target.value)}
                        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" }}
                      />
                      <div style={{ width: "100%", height: "100%", background: c }} />
                    </div>
                    {color.palette.length > 1 && (
                      <button
                        onClick={() => rmPalCol(i)}
                        style={{
                          position: "absolute", top: -4, right: -4,
                          width: 9, height: 9, background: "#000", color: "#fff",
                          fontSize: 7, display: "none", alignItems: "center", justifyContent: "center",
                          lineHeight: 1, cursor: "pointer",
                        }}
                        className="group-hover:flex"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                {color.palette.length < 8 && (
                  <button
                    onClick={addPalCol}
                    className="border border-black flex items-center justify-center hover:bg-black hover:text-white"
                    style={{ width: 20, height: 20, fontSize: 12, opacity: 0.4 }}
                  >
                    +
                  </button>
                )}
              </div>
            )}
          </Section>

          {/* Halo */}
          <Section>
            <div className="flex items-center justify-between mb-[6px]">
              <span className="text-[9px] uppercase" style={{ opacity: 0.32 }}>Halo</span>
              <Toggle value={color.haloEnabled} onChange={setHaloOn} />
            </div>
            {color.haloEnabled && (
              <div className="flex flex-col gap-[7px]">
                <Slider label="Strength" value={color.haloStrength} onChange={setHaloStr} />
                <Slider label="Size"     value={color.haloSize}     onChange={setHaloSz}  />
              </div>
            )}
          </Section>

          {/* Dot */}
          <Section>
            <Label>Dot</Label>
            <div className="flex flex-col gap-[7px]">
              <Slider label="Size"      value={params.dotSize}       onChange={setP("dotSize")}       />
              <Slider label="Variation" value={params.sizeVariation} onChange={setP("sizeVariation")} />
            </div>
          </Section>

          {/* Field */}
          <Section>
            <Label>Field</Label>
            <div className="flex flex-col gap-[7px]">
              <Slider label="Density" value={params.density} onChange={setP("density")} />
              <Slider label="Noise"   value={params.noise}   onChange={setP("noise")}   />
              {hasSpread && (
                <Slider
                  label={formation === "scatter" ? "Drift" : "Width"}
                  value={params.spread}
                  onChange={setP("spread")}
                />
              )}
            </div>
          </Section>

          {/* Grid-only controls */}
          {isGrid && (
            <Section>
              <Label>Grid</Label>
              <Slider label="Spacing" value={params.gridSpacing} min={0.05} max={1} onChange={setP("gridSpacing")} />
              <div className="flex items-center justify-between mt-[8px]">
                <span className="text-[9px] uppercase" style={{ opacity: 0.5 }}>Edge</span>
                <div className="flex items-center gap-0">
                  <button
                    onClick={() => setParams(p => ({ ...p, gridFit: false }))}
                    className="text-[8px] uppercase border border-black px-2 py-[2px]"
                    style={{ background: !params.gridFit ? "#000" : "#fff", color: !params.gridFit ? "#fff" : "#000", borderRight: "none" }}
                  >
                    Tile
                  </button>
                  <button
                    onClick={() => setParams(p => ({ ...p, gridFit: true }))}
                    className="text-[8px] uppercase border border-black px-2 py-[2px]"
                    style={{ background: params.gridFit ? "#000" : "#fff", color: params.gridFit ? "#fff" : "#000" }}
                  >
                    Fit
                  </button>
                </div>
              </div>
            </Section>
          )}

          <div className="flex-1" style={{ minHeight: 12 }} />
        </div>
      </div>
    </div>
  );
}

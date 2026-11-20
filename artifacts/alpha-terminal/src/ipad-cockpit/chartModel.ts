export const CHART_PAD_L = 6;
export const CHART_PLOT_W = 370;
export const SESSION_MINUTES = 144;

export interface ChartWall {
  key: "call" | "put" | "gamma";
  y: number;
  color: string;
  tag: string;
  tagFill: string;
}

export interface ChartBar {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export interface ChartGeometry {
  pricePoints: string;
  areaPath: string;
  endpoint: { x: number; y: number };
  line: string;
  walls: ChartWall[];
  gridX: number[];
  bars: ChartBar[];
  times: { x: number; label: string; anchor: "start" | "middle" | "end" }[];
  flowValue: string;
  flowColor: string;
}

function interpMinute(stops: ReadonlyArray<readonly [number, number]>, minute: number): number {
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!first || !last) return 0;
  if (minute <= first[0]) return first[1];
  if (minute >= last[0]) return last[1];
  for (let i = 1; i < stops.length; i++) {
    const right = stops[i]!;
    const left = stops[i - 1]!;
    if (minute <= right[0]) {
      const span = right[0] - left[0];
      const t = span === 0 ? 0 : (minute - left[0]) / span;
      return left[1] + t * (right[1] - left[1]);
    }
  }
  return last[1];
}

export function priceSeries(stops: ReadonlyArray<readonly [number, number]>, samples = 145): number[] {
  const prices: number[] = [];
  for (let i = 0; i < samples; i++) {
    const minute = (SESSION_MINUTES * i) / (samples - 1);
    prices.push(interpMinute(stops, minute));
  }
  return prices;
}

function yPrice(price: number, minP: number, maxP: number): number {
  const span = maxP - minP || 1;
  const t = (price - minP) / span;
  return 92 - t * (92 - 8);
}

function xAtMinute(minute: number): number {
  return CHART_PAD_L + (minute / SESSION_MINUTES) * CHART_PLOT_W;
}

export function buildChartGeometry(input: {
  prices: readonly number[];
  flowAmps: readonly number[];
  callWall: number;
  putWall: number;
  gammaFlip: number;
  line: string;
  flowValue: string;
  flowColor: string;
}): ChartGeometry {
  const priceMin = Math.min(...input.prices);
  const priceMax = Math.max(...input.prices);
  const minP = Math.min(input.gammaFlip - 10, priceMin) - 4;
  const maxP = Math.max(input.callWall + 8, priceMax) + 4;
  const coords = input.prices.map((price, index) => {
    const x = CHART_PAD_L + (index / Math.max(1, input.prices.length - 1)) * CHART_PLOT_W;
    const y = yPrice(price, minP, maxP);
    return { x, y };
  });
  const pricePoints = coords.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
  const first = coords[0];
  const last = coords[coords.length - 1];
  const areaPath =
    first && last
      ? `M ${first.x.toFixed(2)} 92 L ${coords.map((point) => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" L ")} L ${last.x.toFixed(2)} 92 Z`
      : "";

  const n = input.flowAmps.length;
  const gap = 4;
  const barW = n > 0 ? (CHART_PLOT_W - gap * (n - 1)) / n : 0;
  const zero = 121;
  const maxAmp = 15;
  const bars: ChartBar[] = input.flowAmps.map((amp, index) => {
    const h = Math.max(2, Math.min(1, Math.abs(amp)) * maxAmp);
    const up = amp >= 0;
    return {
      x: CHART_PAD_L + index * (barW + gap),
      y: up ? zero - h : zero,
      w: barW,
      h,
      color: up ? "#2EE58D" : "#FF5252",
    };
  });

  const wall = (key: ChartWall["key"], strike: number, color: string, tag: string, tagFill: string): ChartWall => ({
    key,
    y: yPrice(strike, minP, maxP),
    color,
    tag,
    tagFill,
  });

  return {
    pricePoints,
    areaPath,
    endpoint: last ?? { x: CHART_PAD_L, y: 50 },
    line: input.line,
    walls: [
      wall("call", input.callWall, "#F5B82E", `CW ${input.callWall.toLocaleString("en-US")}`, "#2A210D"),
      wall("put", input.putWall, "#2DD4BF", `PW ${input.putWall.toLocaleString("en-US")}`, "#0D2627"),
      wall("gamma", input.gammaFlip, "#C084FC", `GF ${input.gammaFlip.toLocaleString("en-US")}`, "#231736"),
    ],
    gridX: [0.2, 0.45, 0.7, 0.92].map((pct) => CHART_PAD_L + pct * CHART_PLOT_W),
    bars,
    times: [
      { x: xAtMinute(0), label: "9:30", anchor: "start" },
      { x: xAtMinute(30), label: "10:00", anchor: "middle" },
      { x: xAtMinute(60), label: "10:30", anchor: "middle" },
      { x: xAtMinute(90), label: "11:00", anchor: "middle" },
      { x: xAtMinute(144), label: "11:54", anchor: "end" },
    ],
    flowValue: input.flowValue,
    flowColor: input.flowColor,
  };
}

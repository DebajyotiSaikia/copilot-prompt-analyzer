import * as React from "react";

/**
 * Hand-drawn SVG chart primitives.
 *
 * There is no charting library on purpose. Every shape here is a few dozen
 * lines, inherits the VS Code theme through CSS variables, stays crisp at any
 * zoom, and adds nothing to the bundle — mermaid alone is 3.3 MB and is already
 * loaded on demand for exactly that reason.
 *
 * All charts draw into a fixed viewBox and scale with `width: 100%`, so they are
 * responsive without measuring anything.
 */

const PALETTE = [
  "#818cf8",
  "#34d399",
  "#fbbf24",
  "#f472b6",
  "#60a5fa",
  "#a78bfa",
  "#fb923c",
  "#4ade80",
  "#f87171",
  "#22d3ee",
];

export function paletteColor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

export function formatCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  }
  return String(Math.round(value));
}

export function formatPercent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/** Rounds an axis maximum up to something a person would have chosen. */
function niceMax(value: number): number {
  if (value <= 0) {
    return 1;
  }
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalised = value / magnitude;
  const step =
    normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

interface FrameProps {
  width: number;
  height: number;
  children: React.ReactNode;
  label: string;
}

function Frame({ width, height, children, label }: FrameProps): JSX.Element {
  return (
    <svg
      className="chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      preserveAspectRatio="xMidYMid meet"
    >
      {children}
    </svg>
  );
}

export function ChartEmpty({ message }: { message: string }): JSX.Element {
  return <p className="chart-empty">{message}</p>;
}

/* ------------------------------------------------------------------ */
/* Bars                                                                */
/* ------------------------------------------------------------------ */

export interface BarDatum {
  label: string;
  value: number;
  color?: string;
  hint?: string;
}

/** Horizontal bars — the right choice whenever labels are words, not dates. */
export function BarList({
  data,
  format = formatCount,
  label,
}: {
  data: BarDatum[];
  format?: (value: number) => string;
  label: string;
}): JSX.Element {
  if (data.length === 0) {
    return <ChartEmpty message="Nothing to show for this filter." />;
  }
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ul className="bar-list" aria-label={label}>
      {data.map((datum, index) => (
        <li
          key={datum.label}
          title={datum.hint ?? `${datum.label}: ${format(datum.value)}`}
        >
          <span className="bar-label">{datum.label}</span>
          <span className="bar-track">
            <span
              className="bar-fill"
              style={{
                width: `${(datum.value / max) * 100}%`,
                background: datum.color ?? paletteColor(index),
              }}
            />
          </span>
          <span className="bar-value">{format(datum.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Vertical columns against a time axis. */
export function ColumnChart({
  labels,
  values,
  color = PALETTE[0],
  format = formatCount,
  label,
}: {
  labels: string[];
  values: number[];
  color?: string;
  format?: (value: number) => string;
  label: string;
}): JSX.Element {
  if (values.length === 0) {
    return <ChartEmpty message="Nothing to show for this filter." />;
  }
  const width = 720;
  const height = 220;
  const pad = { top: 12, right: 8, bottom: 28, left: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(...values));
  const slot = plotW / values.length;
  const barWidth = Math.max(2, slot * 0.62);

  return (
    <Frame width={width} height={height} label={label}>
      <Grid pad={pad} plotW={plotW} plotH={plotH} max={max} format={format} />
      {values.map((value, index) => {
        const barHeight = (value / max) * plotH;
        return (
          <rect
            key={labels[index] ?? index}
            x={pad.left + slot * index + (slot - barWidth) / 2}
            y={pad.top + plotH - barHeight}
            width={barWidth}
            height={Math.max(0, barHeight)}
            fill={color}
            rx={2}
          >
            <title>{`${labels[index]}: ${format(value)}`}</title>
          </rect>
        );
      })}
      <TimeAxis labels={labels} pad={pad} plotW={plotW} plotH={plotH} />
    </Frame>
  );
}

function Grid({
  pad,
  plotW,
  plotH,
  max,
  format,
}: {
  pad: { top: number; left: number };
  plotW: number;
  plotH: number;
  max: number;
  format: (value: number) => string;
}): JSX.Element {
  const lines = [0, 0.25, 0.5, 0.75, 1];
  return (
    <g className="chart-grid">
      {lines.map((fraction) => {
        const y = pad.top + plotH - fraction * plotH;
        return (
          <g key={fraction}>
            <line x1={pad.left} y1={y} x2={pad.left + plotW} y2={y} />
            <text x={pad.left - 8} y={y + 3} textAnchor="end">
              {format(max * fraction)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Labels thin themselves out rather than overlapping. */
function TimeAxis({
  labels,
  pad,
  plotW,
  plotH,
}: {
  labels: string[];
  pad: { top: number; left: number };
  plotW: number;
  plotH: number;
}): JSX.Element {
  const every = Math.max(1, Math.ceil(labels.length / 10));
  const slot = plotW / labels.length;
  return (
    <g className="chart-axis">
      {labels.map((text, index) =>
        index % every === 0 ? (
          <text
            key={text ?? index}
            x={pad.left + slot * index + slot / 2}
            y={pad.top + plotH + 18}
            textAnchor="middle"
          >
            {text}
          </text>
        ) : null
      )}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Lines                                                               */
/* ------------------------------------------------------------------ */

export interface LineSeries {
  name: string;
  color?: string;
  points: number[];
  dashed?: boolean;
}

export function LineChart({
  labels,
  series,
  format = formatCount,
  max: forcedMax,
  label,
}: {
  labels: string[];
  series: LineSeries[];
  format?: (value: number) => string;
  max?: number;
  label: string;
}): JSX.Element {
  if (series.length === 0 || labels.length === 0) {
    return <ChartEmpty message="Not enough history to plot a trend yet." />;
  }
  const width = 720;
  const height = 240;
  const pad = { top: 12, right: 8, bottom: 28, left: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const observed = Math.max(...series.flatMap((s) => s.points), 0);
  const max = forcedMax ?? niceMax(observed);
  // A single point has no width to spread across, so it sits in the middle.
  const step = labels.length > 1 ? plotW / (labels.length - 1) : 0;
  const x = (index: number): number =>
    labels.length > 1 ? pad.left + step * index : pad.left + plotW / 2;
  const y = (value: number): number =>
    pad.top + plotH - (max > 0 ? (value / max) * plotH : 0);

  return (
    <Frame width={width} height={height} label={label}>
      <Grid pad={pad} plotW={plotW} plotH={plotH} max={max} format={format} />
      {series.map((line, index) => {
        const color = line.color ?? paletteColor(index);
        const path = line.points
          .map((value, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(value)}`)
          .join(" ");
        return (
          <g key={line.name}>
            <path
              d={path}
              fill="none"
              stroke={color}
              strokeWidth={line.dashed ? 1.5 : 2}
              strokeDasharray={line.dashed ? "4 4" : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {line.points.map((value, i) => (
              <circle key={i} cx={x(i)} cy={y(value)} r={2.5} fill={color}>
                <title>{`${line.name} · ${labels[i]}: ${format(value)}`}</title>
              </circle>
            ))}
          </g>
        );
      })}
      <TimeAxis labels={labels} pad={pad} plotW={plotW} plotH={plotH} />
    </Frame>
  );
}

/* ------------------------------------------------------------------ */
/* Stacked area                                                        */
/* ------------------------------------------------------------------ */

export function StackedArea({
  labels,
  series,
  label,
}: {
  labels: string[];
  series: LineSeries[];
  label: string;
}): JSX.Element {
  if (series.length === 0 || labels.length === 0) {
    return <ChartEmpty message="Not enough history to plot a trend yet." />;
  }
  const width = 720;
  const height = 240;
  const pad = { top: 12, right: 8, bottom: 28, left: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const totals = labels.map((_, i) =>
    series.reduce((sum, s) => sum + (s.points[i] ?? 0), 0)
  );
  const max = niceMax(Math.max(...totals, 1));
  const step = labels.length > 1 ? plotW / (labels.length - 1) : 0;
  const x = (index: number): number =>
    labels.length > 1 ? pad.left + step * index : pad.left + plotW / 2;
  const y = (value: number): number => pad.top + plotH - (value / max) * plotH;

  const baseline = new Array(labels.length).fill(0);

  return (
    <Frame width={width} height={height} label={label}>
      <Grid
        pad={pad}
        plotW={plotW}
        plotH={plotH}
        max={max}
        format={formatCount}
      />
      {series.map((band, index) => {
        const upper = baseline.map((base, i) => base + (band.points[i] ?? 0));
        const forward = upper.map(
          (value, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(value)}`
        );
        const back = baseline
          .map((value, i) => ({ value, i }))
          .reverse()
          .map((entry) => `L ${x(entry.i)} ${y(entry.value)}`);
        const path = [...forward, ...back, "Z"].join(" ");
        for (let i = 0; i < baseline.length; i++) {
          baseline[i] = upper[i];
        }
        return (
          <path
            key={band.name}
            d={path}
            fill={band.color ?? paletteColor(index)}
            fillOpacity={0.75}
          >
            <title>{band.name}</title>
          </path>
        );
      })}
      <TimeAxis labels={labels} pad={pad} plotW={plotW} plotH={plotH} />
    </Frame>
  );
}

/* ------------------------------------------------------------------ */
/* Proportion bar                                                      */
/* ------------------------------------------------------------------ */

/** One bar split into parts — better than a pie for four or five categories. */
export function ProportionBar({
  parts,
  label,
}: {
  parts: BarDatum[];
  label: string;
}): JSX.Element {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  if (total === 0) {
    return <ChartEmpty message="Nothing to show for this filter." />;
  }
  return (
    <div className="proportion" aria-label={label}>
      <div className="proportion-bar">
        {parts.map((part, index) => (
          <span
            key={part.label}
            className="proportion-part"
            style={{
              width: `${(part.value / total) * 100}%`,
              background: part.color ?? paletteColor(index),
            }}
            title={`${part.label}: ${formatCount(part.value)} (${formatPercent(
              part.value / total,
              1
            )})`}
          />
        ))}
      </div>
      <ul className="proportion-key">
        {parts.map((part, index) => (
          <li key={part.label}>
            <span
              className="key-dot"
              style={{ background: part.color ?? paletteColor(index) }}
            />
            <span className="key-name">{part.label}</span>
            <span className="key-value">
              {formatCount(part.value)} · {formatPercent(part.value / total)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Heatmap                                                             */
/* ------------------------------------------------------------------ */

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function Heatmap({
  grid,
  peak,
  label,
}: {
  grid: number[][];
  peak: number;
  label: string;
}): JSX.Element {
  if (peak === 0) {
    return <ChartEmpty message="No timestamps in this selection." />;
  }
  const cell = 26;
  const gap = 3;
  const left = 38;
  const top = 18;
  const width = left + 24 * (cell + gap);
  const height = top + 7 * (cell + gap) + 6;

  return (
    <Frame width={width} height={height} label={label}>
      <g className="chart-axis">
        {DAYS.map((day, row) => (
          <text
            key={day}
            x={left - 8}
            y={top + row * (cell + gap) + cell * 0.7}
            textAnchor="end"
          >
            {day}
          </text>
        ))}
        {Array.from({ length: 24 }, (_, hour) =>
          hour % 3 === 0 ? (
            <text
              key={hour}
              x={left + hour * (cell + gap) + cell / 2}
              y={top - 6}
              textAnchor="middle"
            >
              {hour}
            </text>
          ) : null
        )}
      </g>
      {grid.map((row, day) =>
        row.map((value, hour) => (
          <rect
            key={`${day}-${hour}`}
            x={left + hour * (cell + gap)}
            y={top + day * (cell + gap)}
            width={cell}
            height={cell}
            rx={3}
            className="heat-cell"
            // Squash the scale so a single dominant hour does not black out the rest.
            fillOpacity={
              value === 0 ? 0.06 : 0.15 + 0.85 * Math.sqrt(value / peak)
            }
          >
            <title>{`${DAYS[day]} ${hour}:00 — ${value} prompt(s)`}</title>
          </rect>
        ))
      )}
    </Frame>
  );
}

/* ------------------------------------------------------------------ */
/* Treemap                                                             */
/* ------------------------------------------------------------------ */

export interface TreemapCell {
  label: string;
  value: number;
  color: string;
  hint: string;
}

/**
 * Squarified-enough treemap: a simple slice-and-dice alternating direction,
 * which stays readable at a dozen cells and needs no layout library.
 */
export function Treemap({
  cells,
  label,
}: {
  cells: TreemapCell[];
  label: string;
}): JSX.Element {
  if (cells.length === 0) {
    return (
      <ChartEmpty message="Classify your prompts to see where effort goes." />
    );
  }
  const width = 720;
  const height = 300;
  const total = cells.reduce((sum, cell) => sum + cell.value, 0);

  const boxes: (TreemapCell & {
    x: number;
    y: number;
    w: number;
    h: number;
  })[] = [];
  let x = 0;
  let y = 0;
  let remainingW = width;
  let remainingH = height;
  let remaining = total;
  let horizontal = true;

  cells.forEach((cell, index) => {
    const share = remaining > 0 ? cell.value / remaining : 0;
    const last = index === cells.length - 1;
    if (horizontal) {
      const w = last ? remainingW : remainingW * share;
      boxes.push({ ...cell, x, y, w, h: remainingH });
      x += w;
      remainingW -= w;
    } else {
      const h = last ? remainingH : remainingH * share;
      boxes.push({ ...cell, x, y, w: remainingW, h });
      y += h;
      remainingH -= h;
    }
    remaining -= cell.value;
    horizontal = !horizontal;
  });

  return (
    <Frame width={width} height={height} label={label}>
      <defs>
        {boxes.map((box, index) => (
          <clipPath key={box.label} id={`tm-${index}`}>
            <rect
              x={box.x + 1}
              y={box.y + 1}
              width={Math.max(0, box.w - 2)}
              height={Math.max(0, box.h - 2)}
            />
          </clipPath>
        ))}
      </defs>
      {boxes.map((box, index) => (
        <g key={box.label} clipPath={`url(#tm-${index})`}>
          <rect
            x={box.x + 1}
            y={box.y + 1}
            width={Math.max(0, box.w - 2)}
            height={Math.max(0, box.h - 2)}
            fill={box.color}
            fillOpacity={0.82}
            rx={4}
          >
            <title>{box.hint}</title>
          </rect>
          {box.w > 70 && box.h > 30 ? (
            <text className="treemap-label" x={box.x + 10} y={box.y + 22}>
              {box.label}
            </text>
          ) : null}
          {box.w > 70 && box.h > 48 ? (
            <text className="treemap-value" x={box.x + 10} y={box.y + 40}>
              {formatCount(box.value)}
            </text>
          ) : null}
        </g>
      ))}
    </Frame>
  );
}

/* ------------------------------------------------------------------ */
/* Scatter                                                             */
/* ------------------------------------------------------------------ */

export function Scatter({
  points,
  xLabel,
  yLabel,
  label,
}: {
  points: { x: number; y: number; label: string }[];
  xLabel: string;
  yLabel: string;
  label: string;
}): JSX.Element {
  if (points.length === 0) {
    return <ChartEmpty message="Nothing to plot for this filter." />;
  }
  const width = 720;
  const height = 260;
  const pad = { top: 12, right: 12, bottom: 34, left: 48 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const maxX = niceMax(Math.max(...points.map((p) => p.x), 1));
  const maxY = niceMax(Math.max(...points.map((p) => p.y), 1));

  return (
    <Frame width={width} height={height} label={label}>
      <Grid
        pad={pad}
        plotW={plotW}
        plotH={plotH}
        max={maxY}
        format={formatCount}
      />
      {points.map((point, index) => (
        <circle
          key={index}
          cx={pad.left + (point.x / maxX) * plotW}
          cy={pad.top + plotH - (point.y / maxY) * plotH}
          r={3}
          className="scatter-dot"
        >
          <title>{`${point.label}\n${xLabel}: ${formatCount(point.x)} · ${yLabel}: ${formatCount(point.y)}`}</title>
        </circle>
      ))}
      <g className="chart-axis">
        <text x={pad.left + plotW / 2} y={height - 6} textAnchor="middle">
          {xLabel}
        </text>
        <text x={pad.left} y={height - 6} textAnchor="start">
          0
        </text>
        <text x={pad.left + plotW} y={height - 6} textAnchor="end">
          {formatCount(maxX)}
        </text>
      </g>
    </Frame>
  );
}

/* ------------------------------------------------------------------ */
/* Gantt                                                               */
/* ------------------------------------------------------------------ */

export function Gantt({
  rows,
  label,
}: {
  rows: { name: string; first: number; last: number; count: number }[];
  label: string;
}): JSX.Element {
  if (rows.length === 0) {
    return <ChartEmpty message="No dated prompts in this selection." />;
  }
  const start = Math.min(...rows.map((r) => r.first));
  const end = Math.max(...rows.map((r) => r.last));
  const span = Math.max(1, end - start);

  const rowHeight = 22;
  const left = 128;
  const width = 720;
  const height = rows.length * rowHeight + 26;
  const plotW = width - left - 12;

  const fmt = (ts: number): string =>
    new Date(ts).toLocaleDateString(undefined, {
      month: "short",
      year: "2-digit",
    });

  return (
    <Frame width={width} height={height} label={label}>
      {rows.map((row, index) => {
        const x = left + ((row.first - start) / span) * plotW;
        // A project touched on one day still needs to be visible.
        const barWidth = Math.max(3, ((row.last - row.first) / span) * plotW);
        return (
          <g key={row.name}>
            <text
              className="gantt-label"
              x={left - 10}
              y={index * rowHeight + 16}
              textAnchor="end"
            >
              {row.name}
            </text>
            <rect
              x={x}
              y={index * rowHeight + 5}
              width={barWidth}
              height={12}
              rx={6}
              fill={paletteColor(index)}
              fillOpacity={0.85}
            >
              <title>{`${row.name}: ${fmt(row.first)} → ${fmt(row.last)}, ${formatCount(row.count)} prompt(s)`}</title>
            </rect>
          </g>
        );
      })}
      <g className="chart-axis">
        <text x={left} y={height - 6} textAnchor="start">
          {fmt(start)}
        </text>
        <text x={left + plotW} y={height - 6} textAnchor="end">
          {fmt(end)}
        </text>
      </g>
    </Frame>
  );
}

/* ------------------------------------------------------------------ */
/* Sankey                                                              */
/* ------------------------------------------------------------------ */

export interface SankeyNode {
  id: string;
  month: string;
  label: string;
  color: string;
  value: number;
}

export function Sankey({
  months,
  nodes,
  links,
  label,
}: {
  months: string[];
  nodes: SankeyNode[];
  links: { source: string; target: string; value: number }[];
  label: string;
}): JSX.Element {
  if (months.length < 2 || nodes.length === 0) {
    return (
      <ChartEmpty message="Two months of classified history are needed here." />
    );
  }
  const width = 720;
  const height = 300;
  const columnGap = width / Math.max(1, months.length - 1);
  const nodeWidth = 12;
  const gap = 4;

  // Lay each month out as a column, stacked by volume.
  const placed = new Map<
    string,
    { x: number; y: number; h: number; node: SankeyNode }
  >();
  months.forEach((month, column) => {
    const inColumn = nodes.filter((n) => n.month === month);
    const total = inColumn.reduce((sum, n) => sum + n.value, 0);
    const available = height - gap * Math.max(0, inColumn.length - 1);
    let y = 0;
    for (const node of inColumn) {
      const h = total > 0 ? (node.value / total) * available : 0;
      const x =
        column === months.length - 1
          ? width - nodeWidth
          : Math.min(column * columnGap, width - nodeWidth);
      placed.set(node.id, { x, y, h, node });
      y += h + gap;
    }
  });

  return (
    <Frame width={width} height={height} label={label}>
      {links.map((link, index) => {
        const from = placed.get(link.source);
        const to = placed.get(link.target);
        if (!from || !to) {
          return null;
        }
        const x1 = from.x + nodeWidth;
        const x2 = to.x;
        const mid = (x1 + x2) / 2;
        const thickness = Math.max(1, Math.min(from.h, to.h));
        const path = `M ${x1} ${from.y + from.h / 2} C ${mid} ${from.y + from.h / 2}, ${mid} ${
          to.y + to.h / 2
        }, ${x2} ${to.y + to.h / 2}`;
        return (
          <path
            key={index}
            d={path}
            fill="none"
            stroke={from.node.color}
            strokeOpacity={0.28}
            strokeWidth={thickness}
          >
            <title>{`${from.node.label}: ${formatCount(link.value)} carried over`}</title>
          </path>
        );
      })}
      {[...placed.values()].map(({ x, y, h, node }) => (
        <rect
          key={node.id}
          x={x}
          y={y}
          width={nodeWidth}
          height={Math.max(1, h)}
          rx={2}
          fill={node.color}
        >
          <title>{`${node.label} · ${node.month}: ${formatCount(node.value)}`}</title>
        </rect>
      ))}
    </Frame>
  );
}

/* ------------------------------------------------------------------ */
/* Legend                                                              */
/* ------------------------------------------------------------------ */

export function Legend({
  items,
}: {
  items: { name: string; color: string }[];
}): JSX.Element {
  return (
    <ul className="chart-legend">
      {items.map((item) => (
        <li key={item.name}>
          <span className="key-dot" style={{ background: item.color }} />
          {item.name}
        </li>
      ))}
    </ul>
  );
}

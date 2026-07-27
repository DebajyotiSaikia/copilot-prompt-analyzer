import * as React from "react";

import type {
  Area,
  Classification,
  PromptRecord,
  SessionRecord,
} from "../../src/types";
import {
  BarList,
  ColumnChart,
  Gantt,
  Heatmap,
  Legend,
  LineChart,
  ProportionBar,
  Sankey,
  Scatter,
  StackedArea,
  Treemap,
  formatCount,
  formatPercent,
  paletteColor,
} from "../charts";
import { collectMetrics, dashboardMarkdown, monthLabel } from "../dashboard";

interface Props {
  prompts: PromptRecord[];
  sessions: SessionRecord[];
  classifications: Record<string, Classification>;
  areas: Area[];
  charsPerToken: number;
  scopeLabel: string;
  onCopy: (text: string) => void;
  onSave: (markdown: string) => void;
}

function Card({
  title,
  blurb,
  wide,
  children,
}: {
  title: string;
  blurb: string;
  wide?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className={`chart-card${wide ? " is-wide" : ""}`}>
      <header>
        <h3>{title}</h3>
        <p>{blurb}</p>
      </header>
      <div className="chart-body">{children}</div>
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "warn" | "good";
}): JSX.Element {
  return (
    <div className={`stat${tone ? ` is-${tone}` : ""}`}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      <span className="stat-hint">{hint}</span>
    </div>
  );
}

export function DashboardView({
  prompts,
  sessions,
  classifications,
  areas,
  charsPerToken,
  scopeLabel,
  onCopy,
  onSave,
}: Props): JSX.Element {
  // Everything is derived, and some of it walks the corpus several times, so the
  // whole set is memoised against the filtered prompts.
  const metrics = React.useMemo(
    () =>
      collectMetrics(prompts, sessions, classifications, areas, charsPerToken),
    [prompts, sessions, classifications, areas, charsPerToken]
  );

  if (prompts.length === 0) {
    return (
      <div className="dashboard">
        <div className="empty">
          <h2>Nothing selected</h2>
          <p>
            No prompts match the current filters. Clear them, or rescan your
            history, to populate the dashboard.
          </p>
        </div>
      </div>
    );
  }

  const {
    waste,
    head,
    corrections,
    quality,
    effort,
    heat,
    models,
    modes,
    latency,
    anatomy,
    tools,
    files,
    drift,
    lengthQuality,
    projects,
    duplicates,
    tokens,
    commands,
    replyTools,
  } = metrics;

  const monthLabels = corrections.months.map(monthLabel);

  return (
    <div className="dashboard">
      <header className="dashboard-head">
        <div>
          <h2>Dashboard</h2>
          <p>
            Everything below is computed on your machine from the{" "}
            <strong>{formatCount(head.prompts)}</strong> prompt(s) currently
            selected — {scopeLabel}. No model is called.
          </p>
        </div>
        <div className="dashboard-actions">
          <button
            type="button"
            className="ghost"
            title="Copy every metric on this page as markdown"
            onClick={() =>
              onCopy(dashboardMarkdown(metrics, scopeLabel, charsPerToken))
            }
          >
            Copy summary
          </button>
          <button
            type="button"
            className="ghost"
            title="Save every metric on this page as a markdown file"
            onClick={() =>
              onSave(dashboardMarkdown(metrics, scopeLabel, charsPerToken))
            }
          >
            Save as markdown
          </button>
        </div>
      </header>

      <div className="stat-row">
        <Stat
          label="Prompts"
          value={formatCount(head.prompts)}
          hint={`${formatCount(head.sessions)} sessions · ${formatCount(
            head.projects
          )} projects`}
        />
        <Stat
          label="Span"
          value={`${formatCount(head.days)}d`}
          hint="first to last request"
        />
        <Stat
          label="Corrections"
          value={formatPercent(head.correctionRate, 1)}
          hint="turns spent fixing the answer"
          tone={head.correctionRate > 0.1 ? "warn" : "good"}
        />
        <Stat
          label="Wasted turns"
          value={formatPercent(head.wastedShare, 1)}
          hint="steering, repeats and pastes"
          tone={head.wastedShare > 0.2 ? "warn" : "good"}
        />
        <Stat
          label="Tokens"
          value={formatCount(tokens.total)}
          hint="estimated, prompts and replies"
        />
      </div>

      {/* ---------------- Tier 1 ---------------- */}

      <h3 className="dashboard-section">What to act on</h3>

      <div className="chart-grid">
        <Card
          title="Correction rate over time"
          blurb={
            corrections.worstArea
              ? `Where the assistant keeps getting it wrong. ${corrections.worstArea.label} is the worst at ${formatPercent(
                  corrections.worstArea.rate,
                  1
                )} — every spike is an instruction file you have not written.`
              : "Where the assistant keeps getting it wrong. Every spike is an instruction file you have not written."
          }
          wide
        >
          <LineChart
            labels={monthLabels}
            series={[
              ...corrections.series,
              {
                name: "All areas",
                points: corrections.overall,
                dashed: true,
                color: "#94a3b8",
              },
            ]}
            format={(value) => formatPercent(value)}
            label="Correction rate by area, per month"
          />
          <Legend
            items={[
              ...corrections.series.map((s, i) => ({
                name: s.name,
                color: s.color ?? paletteColor(i),
              })),
              { name: "All areas", color: "#94a3b8" },
            ]}
          />
        </Card>

        <Card
          title="Where the turns went"
          blurb={`${formatPercent(waste.wastedShare, 1)} of your requests carried no new information — ${formatCount(
            waste.pastedChars
          )} characters of that was pasted output.`}
        >
          <ProportionBar
            label="Useful versus wasted turns"
            parts={[
              { label: "Useful", value: waste.useful, color: "#34d399" },
              {
                label: "Steering only",
                value: waste.steering,
                color: "#fbbf24",
              },
              {
                label: "Repeated asks",
                value: waste.duplicate,
                color: "#f472b6",
              },
              { label: "Mostly pasted", value: waste.paste, color: "#f87171" },
            ]}
          />
        </Card>

        <Card
          title="Prompt quality over time"
          blurb={
            quality.change
              ? `The only chart here that measures you rather than the tool. ${
                  quality.change.last >= quality.change.first
                    ? "Trending up"
                    : "Trending down"
                } since your first month.`
              : "Specificity, context and actionability, averaged per month."
          }
          wide
        >
          <LineChart
            labels={monthLabels}
            series={[
              { name: "Specificity", points: quality.specificity },
              { name: "Context", points: quality.context },
              { name: "Actionability", points: quality.actionability },
            ]}
            label="Prompt quality components per month"
          />
          <Legend
            items={["Specificity", "Context", "Actionability"].map(
              (name, i) => ({
                name,
                color: paletteColor(i),
              })
            )}
          />
        </Card>

        <Card
          title="No-information turns"
          blurb="The share of each month spent on 'ok', 'continue' and button presses."
        >
          <ColumnChart
            labels={monthLabels}
            values={quality.emptyShare}
            color="#fbbf24"
            format={(value) => formatPercent(value)}
            label="Share of turns carrying no information, per month"
          />
        </Card>

        <Card
          title="Where your effort goes"
          blurb="Areas sized by volume, coloured by their own accent. Big and painful belongs top-left."
          wide
        >
          <Treemap
            label="Prompt volume by area"
            cells={effort.map((area) => ({
              label: area.label,
              value: area.count,
              color: area.color,
              hint: `${area.label}: ${formatCount(area.count)} prompt(s), ${formatPercent(
                area.correctionRate,
                1
              )} corrections`,
            }))}
          />
        </Card>

        <Card
          title="Correction rate by area"
          blurb="The same areas, ranked by how often you had to push back."
        >
          <BarList
            label="Correction rate by area"
            format={(value) => formatPercent(value / 1000, 1)}
            data={[...effort]
              .filter((area) => area.count >= 10)
              .sort((a, b) => b.correctionRate - a.correctionRate)
              .slice(0, 10)
              .map((area) => ({
                label: area.label,
                // BarList works in absolute values; scale to keep one decimal.
                value: area.correctionRate * 1000,
                color: area.color,
                hint: `${area.label}: ${formatPercent(area.correctionRate, 1)} of ${formatCount(
                  area.count
                )} prompts`,
              }))}
          />
        </Card>
      </div>

      {/* ---------------- Tier 2 ---------------- */}

      <h3 className="dashboard-section">How you work</h3>

      <div className="chart-grid">
        <Card
          title="When you work"
          blurb={`Busiest around ${heat.busiestHour}:00. Late-night prompts are usually your shortest.`}
          wide
        >
          <Heatmap
            grid={heat.grid}
            peak={heat.peak}
            label="Prompts by day and hour"
          />
        </Card>

        <Card
          title="Models over time"
          blurb="What you ran, and when you switched."
          wide
        >
          <StackedArea
            labels={models.months.map(monthLabel)}
            series={models.series}
            label="Prompts by model per month"
          />
          <Legend
            items={models.series.map((s, i) => ({
              name: s.name,
              color: paletteColor(i),
            }))}
          />
        </Card>

        <Card
          title="Response time"
          blurb={`Median ${latency.median.toFixed(1)}s, 90th percentile ${latency.p90.toFixed(
            1
          )}s.`}
        >
          <BarList
            label="Response time distribution"
            data={latency.buckets.map((bucket) => ({
              label: bucket.label,
              value: bucket.count,
              color: "#60a5fa",
            }))}
          />
        </Card>

        <Card
          title="Mode mix"
          blurb="Agent, ask and edit, as your workflow changed."
          wide
        >
          <StackedArea
            labels={modes.months.map(monthLabel)}
            series={modes.series}
            label="Prompts by mode per month"
          />
          <Legend
            items={modes.series.map((s, i) => ({
              name: s.name,
              color: paletteColor(i),
            }))}
          />
        </Card>

        <Card
          title="Session length"
          blurb={`Median ${anatomy.lengths.median.toFixed(0)} prompts. Long sessions drift.`}
        >
          <BarList
            label="Prompts per session"
            data={anatomy.lengths.buckets.map((bucket) => ({
              label: bucket.label,
              value: bucket.count,
              color: "#a78bfa",
            }))}
          />
        </Card>

        <Card
          title="Session duration"
          blurb={`Median ${anatomy.durations.median.toFixed(0)} minutes from first message to last.`}
        >
          <BarList
            label="Session duration"
            data={anatomy.durations.buckets.map((bucket) => ({
              label: bucket.label,
              value: bucket.count,
              color: "#22d3ee",
            }))}
          />
        </Card>

        <Card
          title="Tools the agent reaches for"
          blurb={`${formatCount(tools.totalCalls)} calls in total, ${formatCount(
            tools.heavyTurns
          )} turn(s) burning 20 or more.`}
          wide
        >
          <BarList
            label="Tool usage"
            data={tools.tools.map((tool) => ({
              label: tool.name,
              value: tool.count,
            }))}
          />
        </Card>
      </div>

      {/* ---------------- Tier 3 ---------------- */}

      <h3 className="dashboard-section">Worth a look</h3>

      <div className="chart-grid">
        <Card
          title="File hotspots"
          blurb="The files you drag into chat most — usually where the architecture hurts."
        >
          <BarList
            label="Most referenced files"
            data={files.map((file) => ({
              label: file.name,
              value: file.count,
            }))}
          />
        </Card>

        <Card
          title="Slash commands"
          blurb="Which built-in commands you actually reach for."
        >
          <BarList
            label="Slash command usage"
            data={commands.map((command) => ({
              label: `/${command.name}`,
              value: command.count,
            }))}
          />
        </Card>

        <Card
          title="Topic drift"
          blurb="How work carried from one month to the next. Thin bands are abandoned threads."
          wide
        >
          <Sankey
            months={drift.months}
            nodes={drift.nodes}
            links={drift.links}
            label="Area volume carried between months"
          />
        </Card>

        <Card
          title="Are longer prompts better?"
          blurb="Words against quality score. A flat cloud means length is not the lever."
          wide
        >
          <Scatter
            points={lengthQuality}
            xLabel="words"
            yLabel="quality"
            label="Prompt length against quality score"
          />
        </Card>

        <Card
          title="Do more tools mean more answer?"
          blurb="Tool calls against reply length."
          wide
        >
          <Scatter
            points={replyTools}
            xLabel="tool calls"
            yLabel="reply characters"
            label="Tool calls against reply length"
          />
        </Card>

        <Card
          title="Project timeline"
          blurb="When each project started, and when it went quiet."
          wide
        >
          <Gantt rows={projects} label="First to last prompt per project" />
        </Card>

        <Card
          title="Estimated token spend"
          blurb={`Prompts and replies, at ${charsPerToken.toFixed(1)} characters per token. A proxy, not a bill.`}
          wide
        >
          <StackedArea
            labels={tokens.months.map(monthLabel)}
            series={[
              { name: "Prompts", points: tokens.prompt, color: "#818cf8" },
              { name: "Replies", points: tokens.reply, color: "#34d399" },
            ]}
            label="Estimated tokens per month"
          />
          <Legend
            items={[
              { name: "Prompts", color: "#818cf8" },
              { name: "Replies", color: "#34d399" },
            ]}
          />
        </Card>

        <Card
          title="Questions you asked twice"
          blurb={`${formatCount(duplicates.repeatedAsks)} repeat ask(s). Each cluster is a document you have not written.`}
          wide
        >
          {duplicates.clusters.length === 0 ? (
            <p className="chart-empty">
              No repeated questions in this selection. That is a good sign.
            </p>
          ) : (
            <ul className="cluster-list">
              {duplicates.clusters.map((cluster) => (
                <li key={cluster.sample}>
                  <span className="cluster-size">×{cluster.size}</span>
                  <span className="cluster-body">
                    <span className="cluster-sample">{cluster.sample}</span>
                    <span className="cluster-meta">
                      {cluster.sessions} session(s) · {cluster.spanDays} day
                      span
                      {cluster.keywords.length > 0
                        ? ` · ${cluster.keywords.slice(0, 5).join(", ")}`
                        : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

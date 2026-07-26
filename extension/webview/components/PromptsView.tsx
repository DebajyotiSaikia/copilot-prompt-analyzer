import * as React from "react";

import type { Classification, PromptRecord, Taxonomy } from "../../src/types";
import { UNCLASSIFIED, formatDateTime } from "../selectors";

interface Props {
  prompts: PromptRecord[];
  classifications: Record<string, Classification>;
  taxonomy: Taxonomy;
  selectedId: string | null;
  compact: boolean;
  onSelectPrompt: (prompt: PromptRecord) => void;
}

const PAGE = 100;

export function PromptsView({
  prompts,
  classifications,
  taxonomy,
  selectedId,
  compact,
  onSelectPrompt,
}: Props): JSX.Element {
  const [limit, setLimit] = React.useState(PAGE);
  React.useEffect(() => setLimit(PAGE), [prompts]);

  const areaById = React.useMemo(() => {
    const map = new Map(taxonomy.areas.map((a) => [a.id, a]));
    map.set(UNCLASSIFIED.id, UNCLASSIFIED);
    return map;
  }, [taxonomy]);

  if (prompts.length === 0) {
    return (
      <div className="empty">
        <h2>No prompts match</h2>
        <p>Loosen the filters or clear the search box.</p>
      </div>
    );
  }

  const visible = prompts.slice(0, limit);
  const more =
    limit < prompts.length ? (
      <button
        type="button"
        className="btn load-more"
        onClick={() => setLimit(limit + PAGE * 5)}
      >
        Show more ({(prompts.length - limit).toLocaleString()} remaining)
      </button>
    ) : null;

  if (compact) {
    return (
      <div className="prompt-list">
        {visible.map((prompt) => {
          const classification = classifications[prompt.hash];
          const area =
            areaById.get(classification?.area ?? UNCLASSIFIED.id) ??
            UNCLASSIFIED;
          return (
            <button
              type="button"
              key={prompt.id}
              className={`prompt-item${prompt.id === selectedId ? " is-selected" : ""}`}
              onClick={() => onSelectPrompt(prompt)}
            >
              <span className="prompt-item-head">
                <span
                  className="area-pill"
                  style={{ ["--area" as string]: area.color }}
                >
                  {area.label}
                </span>
                <span className="prompt-item-date">
                  {formatDateTime(prompt.ts).slice(0, 10)}
                </span>
              </span>
              {classification?.intent ? (
                <span className="prompt-item-intent">
                  {classification.intent}
                </span>
              ) : null}
              <span className="prompt-item-text">
                {prompt.text.replace(/\s+/g, " ").slice(0, 180)}
              </span>
              <span className="prompt-item-meta">
                {prompt.workspaceName} ·{" "}
                {prompt.modelLabel ?? prompt.model ?? "—"}
              </span>
            </button>
          );
        })}
        {more}
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="prompt-table">
        <thead>
          <tr>
            <th className="col-date">Date</th>
            <th className="col-area">Area</th>
            <th className="col-intent">Intent</th>
            <th className="col-prompt">Prompt</th>
            <th className="col-ws">Workspace</th>
            <th className="col-model">Model</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((prompt) => {
            const classification = classifications[prompt.hash];
            const area =
              areaById.get(classification?.area ?? UNCLASSIFIED.id) ??
              UNCLASSIFIED;
            return (
              <tr
                key={prompt.id}
                className={prompt.id === selectedId ? "is-selected" : ""}
                onClick={() => onSelectPrompt(prompt)}
              >
                <td className="col-date">{formatDateTime(prompt.ts)}</td>
                <td className="col-area">
                  <span
                    className="area-pill"
                    style={{ ["--area" as string]: area.color }}
                  >
                    {area.label}
                  </span>
                </td>
                <td className="col-intent">{classification?.intent ?? "—"}</td>
                <td className="col-prompt">
                  {prompt.text.replace(/\s+/g, " ")}
                </td>
                <td className="col-ws">{prompt.workspaceName}</td>
                <td className="col-model">
                  {prompt.modelLabel ?? prompt.model ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {more}
    </div>
  );
}

import * as React from "react";

import type { Filter, Taxonomy } from "../../src/types";
import type { AreaBucket, Facets } from "../selectors";
import { EMPTY_FILTER } from "../selectors";

interface Props {
  filter: Filter;
  facets: Facets;
  buckets: AreaBucket[];
  taxonomy: Taxonomy;
  resultCount: number;
  totalCount: number;
  onChange: (next: Filter) => void;
  onRegroup: (instruction: string) => void;
  onResetTaxonomy: () => void;
  busy: boolean;
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

function FacetGroup({
  title,
  options,
  selected,
  onToggle,
  limit = 8,
}: {
  title: string;
  options: { value: string; count: number }[];
  selected: string[];
  onToggle: (value: string) => void;
  limit?: number;
}): JSX.Element | null {
  const [expanded, setExpanded] = React.useState(false);
  if (options.length === 0) {
    return null;
  }
  const visible = expanded ? options : options.slice(0, limit);
  return (
    <section className="facet">
      <h3>{title}</h3>
      <ul>
        {visible.map((option) => (
          <li key={option.value}>
            <label
              className={selected.includes(option.value) ? "is-selected" : ""}
            >
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={() => onToggle(option.value)}
              />
              <span className="facet-name" title={option.value}>
                {option.value}
              </span>
              <span className="facet-count">{option.count}</span>
            </label>
          </li>
        ))}
      </ul>
      {options.length > limit ? (
        <button
          type="button"
          className="link"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show less" : `Show ${options.length - limit} more`}
        </button>
      ) : null}
    </section>
  );
}

export function Filters({
  filter,
  facets,
  buckets,
  resultCount,
  totalCount,
  onChange,
  onRegroup,
  onResetTaxonomy,
  busy,
}: Props): JSX.Element {
  const [instruction, setInstruction] = React.useState("");
  const dirty = JSON.stringify(filter) !== JSON.stringify(EMPTY_FILTER);

  const submitRegroup = (event: React.FormEvent): void => {
    event.preventDefault();
    if (instruction.trim()) {
      onRegroup(instruction.trim());
      setInstruction("");
    }
  };

  return (
    <aside className="sidebar">
      <div className="search-box">
        <input
          type="search"
          placeholder="Search prompts, topics, tags…"
          value={filter.query}
          onChange={(e) => onChange({ ...filter, query: e.target.value })}
        />
      </div>

      <div className="result-line">
        <strong>{resultCount.toLocaleString()}</strong> of{" "}
        {totalCount.toLocaleString()} prompts
        {dirty ? (
          <button
            type="button"
            className="link"
            onClick={() => onChange(EMPTY_FILTER)}
          >
            Clear
          </button>
        ) : null}
      </div>

      <FacetGroup
        title="Area"
        options={buckets.map((b) => ({
          value: b.area.id,
          count: b.prompts.length,
        }))}
        selected={filter.areas}
        onToggle={(value) =>
          onChange({ ...filter, areas: toggle(filter.areas, value) })
        }
        limit={20}
      />
      <FacetGroup
        title="Workspace"
        options={facets.workspaces}
        selected={filter.workspaces}
        onToggle={(value) =>
          onChange({ ...filter, workspaces: toggle(filter.workspaces, value) })
        }
      />
      <FacetGroup
        title="Model"
        options={facets.models}
        selected={filter.models}
        onToggle={(value) =>
          onChange({ ...filter, models: toggle(filter.models, value) })
        }
      />
      <FacetGroup
        title="Mode"
        options={facets.modes}
        selected={filter.modes}
        onToggle={(value) =>
          onChange({ ...filter, modes: toggle(filter.modes, value) })
        }
        limit={6}
      />

      <section className="facet">
        <h3>Date range</h3>
        <div className="date-row">
          <input
            type="date"
            value={filter.from ?? ""}
            onChange={(e) =>
              onChange({ ...filter, from: e.target.value || null })
            }
          />
          <span>to</span>
          <input
            type="date"
            value={filter.to ?? ""}
            onChange={(e) =>
              onChange({ ...filter, to: e.target.value || null })
            }
          />
        </div>
      </section>

      <section className="facet regroup">
        <h3>Regroup with AI</h3>
        <form onSubmit={submitRegroup}>
          <textarea
            rows={3}
            placeholder="e.g. group by product feature instead of technical layer"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            disabled={busy}
          />
          <div className="regroup-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || !instruction.trim()}
            >
              Regroup
            </button>
            <button
              type="button"
              className="link"
              onClick={onResetTaxonomy}
              disabled={busy}
            >
              Reset
            </button>
          </div>
        </form>
        <p className="hint">
          Rebuilds the taxonomy and reclassifies every prompt.
        </p>
      </section>
    </aside>
  );
}

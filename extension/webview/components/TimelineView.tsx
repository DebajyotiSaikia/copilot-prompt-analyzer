import * as React from "react";

import type { Taxonomy } from "../../src/types";
import type { MonthBucket } from "../selectors";
import { UNCLASSIFIED } from "../selectors";

interface Props {
  months: MonthBucket[];
  taxonomy: Taxonomy;
  onFocusArea: (areaId: string) => void;
}

export function TimelineView({
  months,
  taxonomy,
  onFocusArea,
}: Props): JSX.Element {
  const areaById = React.useMemo(() => {
    const map = new Map(taxonomy.areas.map((a) => [a.id, a]));
    map.set(UNCLASSIFIED.id, UNCLASSIFIED);
    return map;
  }, [taxonomy]);

  if (months.length === 0) {
    return (
      <div className="empty">
        <h2>No dated prompts</h2>
        <p>Nothing in the current selection carries a timestamp.</p>
      </div>
    );
  }

  const peak = Math.max(...months.map((m) => m.total));
  const present = new Set(months.flatMap((m) => [...m.byArea.keys()]));

  return (
    <div className="timeline">
      <div
        className="timeline-chart"
        style={{ ["--rows" as string]: String(months.length) }}
      >
        {months.map((month) => (
          <div className="timeline-row" key={month.month}>
            <span className="timeline-label">{month.month}</span>
            <div
              className="timeline-bar"
              style={{ width: `${(month.total / peak) * 100}%` }}
            >
              {[...month.byArea.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([areaId, count]) => {
                  const area = areaById.get(areaId) ?? UNCLASSIFIED;
                  return (
                    <span
                      key={areaId}
                      className="timeline-seg"
                      style={{
                        width: `${(count / month.total) * 100}%`,
                        background: area.color,
                      }}
                      title={`${area.label}: ${count}`}
                    />
                  );
                })}
            </div>
            <span className="timeline-total">{month.total}</span>
          </div>
        ))}
      </div>

      <div className="legend">
        {[...present]
          .map((id) => areaById.get(id) ?? UNCLASSIFIED)
          .sort((a, b) => a.label.localeCompare(b.label))
          .map((area) => (
            <button
              type="button"
              key={area.id}
              className="legend-item"
              onClick={() => onFocusArea(area.id)}
            >
              <span className="legend-dot" style={{ background: area.color }} />
              {area.label}
            </button>
          ))}
      </div>
    </div>
  );
}

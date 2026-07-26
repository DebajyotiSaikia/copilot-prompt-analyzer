import type {
  Classification,
  GeneratedPrompt,
  PromptRecord,
} from "../../src/types";
import type { AreaBucket } from "../selectors";
import { formatDate } from "../selectors";

interface Props {
  buckets: AreaBucket[];
  classifications: Record<string, Classification>;
  generated: Record<string, GeneratedPrompt>;
  generatingArea: string | null;
  onFocusArea: (areaId: string) => void;
  onSelectPrompt: (prompt: PromptRecord) => void;
  onAskAbout: (areaLabel: string) => void;
  onBuildPrompt: (areaId: string) => void;
}

export function AreasView({
  buckets,
  classifications,
  generated,
  generatingArea,
  onFocusArea,
  onSelectPrompt,
  onAskAbout,
  onBuildPrompt,
}: Props): JSX.Element {
  if (buckets.length === 0) {
    return (
      <div className="empty">
        <h2>Nothing to group yet</h2>
        <p>
          Rescan your chat history, then run “Classify with AI” to sort prompts
          into areas.
        </p>
      </div>
    );
  }

  return (
    <div className="area-grid">
      {buckets.map((bucket) => (
        <article
          className="area-card"
          key={bucket.area.id}
          style={{ ["--area" as string]: bucket.area.color }}
        >
          <header>
            <div className="area-title">
              <span className="area-dot" />
              <h2>{bucket.area.label}</h2>
            </div>
            <span className="area-count">{bucket.prompts.length}</span>
          </header>

          <div className="area-body">
            <div className="area-share" role="presentation">
              <div
                className="area-share-fill"
                style={{ width: `${Math.max(2, bucket.share * 100)}%` }}
              />
            </div>
            <p className="area-share-label">
              {(bucket.share * 100).toFixed(1)}% of selection · last{" "}
              {formatDate(bucket.lastTs)}
            </p>

            {bucket.topics.length > 0 ? (
              <ul className="topic-list">
                {bucket.topics.map((topic) => (
                  <li key={topic.value}>
                    <span className="topic-name">{topic.value}</span>
                    <span className="topic-count">{topic.count}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="area-desc">{bucket.area.description}</p>
            )}

            {bucket.tags.length > 0 ? (
              <div className="chips">
                {bucket.tags.slice(0, 6).map((tag) => (
                  <span className="chip" key={tag.value}>
                    {tag.value}
                  </span>
                ))}
              </div>
            ) : null}

            <ul className="area-samples">
              {bucket.prompts.slice(0, 3).map((prompt) => (
                <li key={prompt.id}>
                  <button type="button" onClick={() => onSelectPrompt(prompt)}>
                    <span className="sample-intent">
                      {classifications[prompt.hash]?.intent ??
                        prompt.workspaceName}
                    </span>
                    <span className="sample-text">
                      {prompt.text.replace(/\s+/g, " ").slice(0, 110)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Never shrinks and never scrolls away: the actions are the point of the card. */}
          <div className="area-actions">
            <div className="area-build">
              <button
                type="button"
                className="btn btn-build"
                onClick={() => onBuildPrompt(bucket.area.id)}
                disabled={generatingArea !== null}
                title={`Distil all ${bucket.prompts.length} requests in ${bucket.area.label} into one reusable prompt`}
              >
                {generatingArea === bucket.area.id
                  ? "Building…"
                  : generated[bucket.area.id]
                    ? "View working prompt"
                    : "Build working prompt"}
              </button>
              {generated[bucket.area.id] ? (
                <span
                  className="area-build-flag"
                  title="A working prompt already exists for this area"
                >
                  ✓
                </span>
              ) : null}
            </div>

            <footer>
              <button
                type="button"
                className="link"
                onClick={() => onFocusArea(bucket.area.id)}
              >
                Focus this area
              </button>
              <button
                type="button"
                className="link"
                onClick={() => onAskAbout(bucket.area.label)}
              >
                Ask about it
              </button>
            </footer>
          </div>
        </article>
      ))}
    </div>
  );
}

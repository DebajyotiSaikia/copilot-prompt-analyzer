import * as React from "react";

import type { Classification, PromptRecord } from "../../src/types";
import { formatDateTime } from "../selectors";

interface Props {
  prompt: PromptRecord;
  classification: Classification | undefined;
  areaLabel: string;
  areaColor: string;
  onClose: () => void;
  onCopy: (text: string) => void;
  onOpenSession: (sessionId: string) => void;
  onImprove: () => void;
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}): JSX.Element {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{value}</span>
    </div>
  );
}

export function DetailDrawer({
  prompt,
  classification,
  areaLabel,
  areaColor,
  onClose,
  onCopy,
  onOpenSession,
  onImprove,
}: Props): JSX.Element {
  return (
    <aside className="detail">
      <header>
        <span className="area-pill" style={{ ["--area" as string]: areaColor }}>
          {areaLabel}
        </span>
        <button
          type="button"
          className="icon-btn"
          onClick={onClose}
          aria-label="Close details"
        >
          ✕
        </button>
      </header>

      <h2>{classification?.intent ?? "Prompt detail"}</h2>
      {classification?.subarea ? (
        <p className="detail-subarea">{classification.subarea}</p>
      ) : null}

      {classification?.tags?.length ? (
        <div className="chips">
          {classification.tags.map((tag) => (
            <span className="chip" key={tag}>
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <section className="detail-block">
        <div className="detail-block-head">
          <h3>Prompt</h3>
          <button
            type="button"
            className="link"
            onClick={() => onCopy(prompt.text)}
          >
            Copy
          </button>
        </div>
        <pre className="detail-text">{prompt.text}</pre>
      </section>

      {prompt.reply ? (
        <section className="detail-block">
          <div className="detail-block-head">
            <h3>Reply (excerpt)</h3>
            <button
              type="button"
              className="link"
              onClick={() => onCopy(prompt.reply)}
            >
              Copy
            </button>
          </div>
          <pre className="detail-text detail-reply">{prompt.reply}</pre>
        </section>
      ) : null}

      <section className="detail-block">
        <h3>Metadata</h3>
        <Row label="When" value={formatDateTime(prompt.ts)} />
        <Row
          label="Workspace"
          value={
            /* Only the folder name is rendered; the absolute path would leak a
               username in screenshots and recordings. Full path on hover. */
            <span title={prompt.workspace ?? undefined}>
              {prompt.workspaceName}
            </span>
          }
        />
        <Row label="Model" value={prompt.modelLabel ?? prompt.model ?? "—"} />
        <Row label="Mode" value={prompt.mode ?? "—"} />
        <Row
          label="Length"
          value={`${prompt.chars.toLocaleString()} chars · ${prompt.words} words`}
        />
        <Row label="Tool calls" value={prompt.toolCalls} />
        {prompt.elapsedMs ? (
          <Row
            label="Response time"
            value={`${(prompt.elapsedMs / 1000).toFixed(1)}s`}
          />
        ) : null}
        {prompt.refs.length ? (
          <Row label="Attached" value={prompt.refs.join(", ")} />
        ) : null}
        {prompt.tools.length ? (
          <Row
            label="Tools"
            value={
              <span className="chips">
                {prompt.tools.map((tool) => (
                  <span className="chip" key={tool}>
                    {tool}
                  </span>
                ))}
              </span>
            }
          />
        ) : null}
      </section>

      <footer className="detail-footer">
        <button type="button" className="btn btn-primary" onClick={onImprove}>
          Improve this prompt
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => onOpenSession(prompt.sessionId)}
        >
          Open source session
        </button>
      </footer>
    </aside>
  );
}

import * as React from "react";

import type { SaveFormat } from "../../src/types";
import { renderMarkdown } from "../markdown";
import { renderMermaidBlocks } from "../mermaid";

export interface SaveOption {
  label: string;
  format: SaveFormat;
  title?: string;
}

interface Props {
  eyebrow: string;
  title: string;
  meta: string;
  accent: string;
  markdown: string;
  generating: boolean;
  hasStored: boolean;
  generateLabel: string;
  /** hidden for reports, which take no extra steer */
  extra?: {
    value: string;
    placeholder: string;
    onChange: (value: string) => void;
  };
  saveOptions: SaveOption[];
  emptyState: React.ReactNode;
  estimate: string | null;
  onGenerate: () => void;
  onCancel: () => void;
  onCopy: (text: string) => void;
  onSave: (format: SaveFormat) => void;
  onClear: (() => void) | null;
  onClose: () => void;
}

export function DocumentModal({
  eyebrow,
  title,
  meta,
  accent,
  markdown,
  generating,
  hasStored,
  generateLabel,
  extra,
  saveOptions,
  emptyState,
  estimate,
  onGenerate,
  onCancel,
  onCopy,
  onSave,
  onClear,
  onClose,
}: Props): JSX.Element {
  const [raw, setRaw] = React.useState(false);
  const body = React.useRef<HTMLDivElement>(null);
  const hasContent = markdown.trim().length > 0;
  const steering = Boolean(extra?.value.trim());

  // The steer box is only obviously connected to the button if the button says so.
  const primaryLabel = steering
    ? hasContent
      ? "Send & regenerate"
      : "Send & generate"
    : hasContent
      ? "Regenerate"
      : generateLabel;

  React.useEffect(() => {
    if (generating) {
      body.current?.scrollTo({ top: body.current.scrollHeight });
    }
  }, [markdown, generating]);

  // Diagrams are only worth rendering once the stream has settled.
  React.useEffect(() => {
    if (!generating && !raw) {
      void renderMermaidBlocks(body.current);
    }
  }, [markdown, generating, raw]);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="studio-backdrop" onClick={onClose}>
      <section
        className="studio"
        style={{ ["--area" as string]: accent }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <header className="studio-head">
          <div>
            <span className="studio-eyebrow">
              <span className="area-dot" /> {eyebrow}
            </span>
            <h2>{title}</h2>
            <p className="studio-meta">{meta}</p>
          </div>
          <div className="studio-head-actions">
            {hasContent ? (
              <button
                type="button"
                className="link"
                onClick={() => setRaw((current) => !current)}
              >
                {raw ? "Rendered" : "Markdown"}
              </button>
            ) : null}
            <button
              type="button"
              className="icon-btn"
              onClick={onClose}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="studio-body" ref={body}>
          {hasContent ? (
            raw ? (
              <pre className="studio-raw">{markdown}</pre>
            ) : (
              <div
                className="studio-rendered"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
              />
            )
          ) : (
            <div className="studio-empty">{emptyState}</div>
          )}
          {generating ? <p className="thinking">Generating…</p> : null}
        </div>

        <footer className="studio-foot">
          {extra ? (
            <textarea
              rows={2}
              placeholder={extra.placeholder}
              value={extra.value}
              onChange={(event) => extra.onChange(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  (event.ctrlKey || event.metaKey) &&
                  !generating
                ) {
                  event.preventDefault();
                  onGenerate();
                }
              }}
              disabled={generating}
            />
          ) : null}
          <div className="studio-actions">
            {generating ? (
              <button type="button" className="btn" onClick={onCancel}>
                Stop
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={onGenerate}
                title={
                  steering
                    ? "Rebuild the document using the instruction below"
                    : undefined
                }
              >
                {primaryLabel}
              </button>
            )}
            <button
              type="button"
              className="btn"
              onClick={() => onCopy(markdown)}
              disabled={!hasContent || generating}
            >
              Copy
            </button>
            {estimate ? (
              <span className="studio-estimate">{estimate}</span>
            ) : null}
            <span className="studio-save">
              {saveOptions.map((option) => (
                <button
                  key={option.format + option.label}
                  type="button"
                  className="btn"
                  onClick={() => onSave(option.format)}
                  disabled={!hasStored || generating}
                  title={option.title}
                >
                  {option.label}
                </button>
              ))}
            </span>
            {onClear && hasStored && !generating ? (
              <button type="button" className="link" onClick={onClear}>
                Discard
              </button>
            ) : null}
          </div>
        </footer>
      </section>
    </div>
  );
}

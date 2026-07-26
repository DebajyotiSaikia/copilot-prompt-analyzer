import * as React from "react";

import { renderMarkdown } from "../markdown";
import { renderMermaidBlocks } from "../mermaid";

export interface Turn {
  id: string;
  role: "user" | "assistant";
  text: string;
  scope: string;
}

interface Props {
  turns: Turn[];
  streaming: boolean;
  scopeLabel: string;
  scopeCount: number;
  draft: string;
  compact: boolean;
  onDraftChange: (value: string) => void;
  onAsk: (question: string) => void;
  onCancel: () => void;
  onClear: () => void;
  onClose: () => void;
}

const SUGGESTIONS = [
  "What are the recurring themes across these prompts?",
  "Which areas do I spend the most time on, and how has that shifted over time?",
  "Summarise every security-related thing I asked about.",
  "What did I repeatedly have to correct the assistant on?",
  "Extract every distinct bug I reported, with dates.",
];

export function AskPanel({
  turns,
  streaming,
  scopeLabel,
  scopeCount,
  draft,
  compact,
  onDraftChange,
  onAsk,
  onCancel,
  onClear,
  onClose,
}: Props): JSX.Element {
  const bottom = React.useRef<HTMLDivElement>(null);
  const log = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  React.useEffect(() => {
    if (!streaming) {
      void renderMermaidBlocks(log.current);
    }
  }, [turns, streaming]);

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    const question = draft.trim();
    if (question && !streaming) {
      onAsk(question);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const question = draft.trim();
      if (question && !streaming) {
        onAsk(question);
      }
    }
  };

  return (
    <section className={`ask${compact ? " is-inline" : ""}`}>
      <header className="ask-head">
        <div>
          <h2>Ask your history</h2>
          <p className="ask-scope">
            Scoped to <strong>{scopeCount.toLocaleString()}</strong> prompt(s) ·{" "}
            {scopeLabel}
          </p>
        </div>
        <div className="ask-head-actions">
          {turns.length > 0 ? (
            <button type="button" className="link" onClick={onClear}>
              Clear
            </button>
          ) : null}
          {compact ? null : (
            <button
              type="button"
              className="icon-btn"
              onClick={onClose}
              aria-label="Close ask panel"
            >
              ✕
            </button>
          )}
        </div>
      </header>

      <div className="ask-log" ref={log}>
        {turns.length === 0 ? (
          <div className="ask-intro">
            <p>
              Questions are answered from the prompts currently selected by your
              filters — change the filters to change the evidence.
            </p>
            <ul className="suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <li key={suggestion}>
                  <button
                    type="button"
                    onClick={() => onAsk(suggestion)}
                    disabled={streaming}
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          turns.map((turn) => (
            <article key={turn.id} className={`turn turn-${turn.role}`}>
              {turn.role === "user" ? (
                <>
                  <p className="turn-text">{turn.text}</p>
                  <span className="turn-scope">{turn.scope}</span>
                </>
              ) : (
                <div
                  className="turn-answer"
                  dangerouslySetInnerHTML={{
                    __html: turn.text
                      ? renderMarkdown(turn.text)
                      : '<p class="thinking">Thinking…</p>',
                  }}
                />
              )}
            </article>
          ))
        )}
        <div ref={bottom} />
      </div>

      <form className="ask-input" onSubmit={submit}>
        <textarea
          rows={3}
          value={draft}
          placeholder="Ask anything about your prompts or the replies you got…"
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="ask-actions">
          <span className="hint">
            Enter to send · Shift+Enter for a new line
          </span>
          {streaming ? (
            <button type="button" className="btn" onClick={onCancel}>
              Stop
            </button>
          ) : (
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!draft.trim()}
            >
              Ask
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

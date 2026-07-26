import type { Report, ReportId } from "../../src/types";

export interface ReportCard {
  id: ReportId;
  title: string;
  blurb: string;
  local: boolean;
}

/** Mirrors REPORTS in src/promptBuilder.ts; kept here so the webview has no host imports. */
export const REPORT_CARDS: ReportCard[] = [
  {
    id: "instructions",
    title: "Global Copilot instructions",
    blurb:
      "The standing rules that hold across every project, ready to drop into .github/copilot-instructions.md.",
    local: false,
  },
  {
    id: "corrections",
    title: "Correction patterns",
    blurb:
      "Where the assistant repeatedly gets it wrong for you, clustered into failure modes with a rule that prevents each.",
    local: false,
  },
  {
    id: "quality",
    title: "Prompt quality",
    blurb:
      "How specific, contextual and actionable your prompts are, and how many turns carried no information at all.",
    local: true,
  },
  {
    id: "duplicates",
    title: "Repeated questions",
    blurb:
      "Questions you asked more than once across sessions — each cluster is a missing instruction file or skill.",
    local: true,
  },
  {
    id: "projects",
    title: "Project specs",
    blurb:
      "What each project is, its stack, architecture and decisions — reconstructed from the questions you asked.",
    local: false,
  },
  {
    id: "decisions",
    title: "Decision log",
    blurb:
      "Architecture decisions stated in chat, as a dated timeline plus ADR records, including reversals.",
    local: false,
  },
  {
    id: "pastes",
    title: "Paste hygiene",
    blurb:
      "Prompts that are mostly pasted terminal output or data, what they cost you, and the cheaper alternative.",
    local: true,
  },
];

interface Props {
  reports: Partial<Record<ReportId, Report>>;
  busyReport: ReportId | null;
  scopeCount: number;
  onOpen: (reportId: ReportId) => void;
}

export function InsightsView({
  reports,
  busyReport,
  scopeCount,
  onOpen,
}: Props): JSX.Element {
  return (
    <div className="insights">
      <p className="insights-intro">
        Each report is built from the{" "}
        <strong>{scopeCount.toLocaleString()}</strong> prompt(s) your filters
        currently select. Reports marked{" "}
        <span className="tag-local">local</span> are computed on your machine
        and cost nothing.
      </p>

      <div className="insight-grid">
        {REPORT_CARDS.map((card) => {
          const report = reports[card.id];
          const running = busyReport === card.id;
          return (
            <article
              key={card.id}
              className={`insight-card${report ? " is-ready" : ""}`}
              onClick={() => onOpen(card.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpen(card.id);
                }
              }}
            >
              <header>
                <h3>{card.title}</h3>
                {card.local ? <span className="tag-local">local</span> : null}
              </header>
              <p>{card.blurb}</p>
              <footer>
                {running ? (
                  <span className="insight-state is-running">Building…</span>
                ) : report ? (
                  <span className="insight-state is-ready">
                    Ready · {new Date(report.generatedAt).toLocaleDateString()}{" "}
                    · {report.meta}
                  </span>
                ) : (
                  <span className="insight-state">Not generated</span>
                )}
              </footer>
            </article>
          );
        })}
      </div>
    </div>
  );
}

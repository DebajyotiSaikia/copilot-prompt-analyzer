// The spoken script. Each entry is one beat of the demo; capture.mjs holds the
// screen until its line has finished, so the picture and the words stay in sync.
export const NARRATION = [
  {
    id: "intro",
    text: "Every prompt you have ever typed into Copilot Chat is already on your disk. Copilot Prompt Analyzer reads that history and turns it into something you can actually use.",
  },
  {
    id: "areas",
    text: "Your prompts are grouped into areas of work. Each card shows how many requests landed there, which projects they came from, and how recently you touched it.",
  },
  {
    id: "model",
    text: "You choose the model. The reasoning levels and context window are queried from the provider, not hard coded, so the list always matches what your account can actually run.",
  },
  {
    id: "search",
    text: "One search box narrows everything at once. Type a word and the areas, the prompts, the timeline and every report re-scope to just those requests.",
  },
  {
    id: "prompts",
    text: "The prompts tab is the raw record. Every request, dated, with its project, the model that answered, and how many tools the answer needed.",
  },
  {
    id: "detail",
    text: "Open one and you get the full prompt, the reply, and the files that turn touched.",
  },
  {
    id: "timeline",
    text: "The timeline shows how your work moved between areas over months, so you can see when a project started and when it went quiet.",
  },
  {
    id: "insights",
    text: "Insights is where the history pays for itself. Seven reports. The ones marked local are computed on your machine and cost nothing.",
  },
  {
    id: "report",
    text: "Prompt quality scores every request you wrote for specificity, context and clarity, then shows the weakest ones so you can see the habit behind them.",
  },
  {
    id: "outro",
    text: "Areas, prompts, insights, and a reusable working prompt for every area of your work. Copilot Prompt Analyzer, for Visual Studio Code.",
  },
];

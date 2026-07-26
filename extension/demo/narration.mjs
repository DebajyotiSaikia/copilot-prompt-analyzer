// The spoken script. Each entry is one beat of the demo; capture.mjs holds the
// screen until its line has finished, so the picture and the words stay in sync.
//
// The beats marked "needs a model" only run when the recording profile is
// signed in to Copilot. Their clips are still synthesised — unused lines simply
// never get cued — so the script does not have to change either way.
export const NARRATION = [
  {
    id: "intro",
    text: "Every prompt you have ever typed into Copilot Chat is already on your disk. Copilot Prompt Analyzer reads that history and turns it into something you can actually use.",
  },
  {
    // needs a model
    id: "workingPrompt",
    text: "This is the point of the whole thing. Pick an area and it reads every request you ever made in it, then writes one reusable prompt: the rules, your conventions, and a do-not list mined from the corrections you had to issue. Save it and it becomes a slash command in chat.",
  },
  {
    id: "areas",
    text: "Your prompts are grouped into areas of work. Each card shows how many requests landed there, which projects they came from, and how recently you touched it.",
  },
  {
    id: "dashboard",
    text: "The dashboard opens in its own tab. Correction rate over time, so you can see where the assistant keeps failing you. How many of your turns carried no information at all. Whether your prompts are getting better. And where your effort actually goes. All of it computed on your machine, in an instant, with no model involved.",
  },
  {
    id: "dashboardScroll",
    text: "Below that: when you work, which models you ran, how long answers took, which tools the agent reaches for, the files you drag in most, and the questions you have asked more than once.",
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
    // needs a model
    id: "aiReport",
    text: "The model-written ones go further. Correction patterns clusters every time you had to say no, not like that, into failure modes — each with a rule that prevents it happening again.",
  },
  {
    // needs a model
    id: "ask",
    text: "And you can simply ask. Questions are answered from the prompts your filters select, and the answer cites the ones it used.",
  },
  {
    id: "outro",
    text: "Areas, prompts, insights, and a reusable working prompt for every area of your work. Copilot Prompt Analyzer, for Visual Studio Code.",
  },
];

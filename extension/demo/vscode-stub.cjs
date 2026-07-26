// Minimal stand-in for the `vscode` module so demo assets can be produced
// outside the editor. Nothing here is called at import time.
class Disposable {
  constructor(fn) {
    this._fn = fn;
  }
  dispose() {
    if (this._fn) this._fn();
  }
}

module.exports = {
  Disposable,
  EventEmitter: class {
    get event() {
      return () => new Disposable(() => {});
    }
    fire() {}
    dispose() {}
  },
  LanguageModelError: class extends Error {},
  CancellationError: class extends Error {},
  LanguageModelChatMessage: { User: (text) => ({ role: 1, content: text }) },
  ProgressLocation: { Notification: 15 },
  ViewColumn: { One: 1, Beside: -2 },
  Uri: { file: (p) => ({ fsPath: p, path: p }), joinPath: (...a) => a },
  workspace: {
    getConfiguration: () => ({ get: (_k, fallback) => fallback }),
    workspaceFolders: undefined,
  },
  window: {},
  commands: {},
  env: {},
  lm: {
    onDidChangeChatModels: () => new Disposable(() => {}),
    selectChatModels: async () => [],
  },
};

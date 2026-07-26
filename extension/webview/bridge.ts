import type { InboundMessage, OutboundMessage } from "../src/types";

interface VsCodeApi {
  postMessage(message: InboundMessage): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export const vscode = acquireVsCodeApi();

export function post(message: InboundMessage): void {
  vscode.postMessage(message);
}

export function onMessage(
  handler: (message: OutboundMessage) => void
): () => void {
  const listener = (event: MessageEvent<OutboundMessage>): void =>
    handler(event.data);
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

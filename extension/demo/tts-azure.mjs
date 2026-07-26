// Azure AI Speech narration. Uses the HD neural voices, which are a large step
// up from the offline Windows engine, and falls back to that engine when no key
// is configured so the demo can always be rebuilt.
//
// Key lookup, first hit wins:
//   AZURE_SPEECH_KEY            the key itself
//   AZURE_SPEECH_KEY_FILE       a file containing it
//   demo/.azure-speech-key      git-ignored local file
//
// Region defaults to the one the resource reports (eastus2) and can be
// overridden with AZURE_SPEECH_REGION.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const KEY_FILE = join(here, ".azure-speech-key");

export const VOICE =
  process.env.AZURE_SPEECH_VOICE ?? "en-US-Ava:DragonHDLatestNeural";
const REGION = process.env.AZURE_SPEECH_REGION ?? "eastus2";

/** Returns the key, or null when Azure narration is not configured. */
export function speechKey() {
  if (process.env.AZURE_SPEECH_KEY) {
    return process.env.AZURE_SPEECH_KEY.trim();
  }
  const file = process.env.AZURE_SPEECH_KEY_FILE ?? KEY_FILE;
  if (existsSync(file)) {
    const value = readFileSync(file, "utf8").trim();
    return value || null;
  }
  return null;
}

function escapeXml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Synthesises one line to a 24 kHz mono WAV. WAV rather than MP3 so the
 * duration can be read straight from the RIFF header.
 */
export async function synthesize(text, outFile) {
  const key = speechKey();
  if (!key) {
    throw new Error("No Azure Speech key configured");
  }
  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">` +
    `<voice name="${VOICE}">${escapeXml(text)}</voice>` +
    `</speak>`;

  const res = await fetch(
    `https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm",
        "User-Agent": "copilot-chat-analyzer-demo",
      },
      body: ssml,
    }
  );

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`Speech API ${res.status}: ${detail}`);
  }
  writeFileSync(outFile, Buffer.from(await res.arrayBuffer()));
}

// Builds the demo voice track and mixes it onto the stitched video.
//
//   node demo/voiceover.mjs            render the clips only
//   node demo/voiceover.mjs --force    re-render even if nothing changed
//
// Narration is read by Azure AI Speech when a key is configured, and by the
// offline Windows engine otherwise. capture.mjs imports renderVoice() and
// muxVoice(); rendering first lets the capture hold each beat for exactly as
// long as its line takes to read.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NARRATION } from "./narration.mjs";
import { speechKey, synthesize, VOICE } from "./tts-azure.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const voiceDir = join(here, "voice");

/** Reads the duration straight out of the RIFF header — no ffprobe needed. */
function wavSeconds(file) {
  const buf = readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error(`Not a WAV file: ${file}`);
  }
  let byteRate = 0;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      byteRate = buf.readUInt32LE(offset + 16);
    } else if (id === "data" && byteRate > 0) {
      return size / byteRate;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error(`No data chunk in ${file}`);
}

/** Reads every line with the offline Windows engine. */
function renderWithWindows(manifest) {
  const out = execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      join(here, "tts.ps1"),
      "-Manifest",
      manifest,
      "-OutDir",
      voiceDir,
    ],
    { encoding: "utf8" }
  );
  const line = out.split("\n").find((text) => text.startsWith("voice:"));
  console.log(line ? line.trim() : "voice: Windows speech engine");
}

/** Reads every line with Azure AI Speech. */
async function renderWithAzure() {
  console.log(`voice: ${VOICE} (Azure AI Speech)`);
  for (const line of NARRATION) {
    await synthesize(line.text, join(voiceDir, `${line.id}.wav`));
    console.log(`clip: ${line.id}`);
  }
}

/**
 * Synthesises every line and returns id -> { file, duration }. Cached on disk
 * against the script and the engine, so re-running the capture does not
 * re-synthesise unchanged narration.
 */
export async function renderVoice({ force = false } = {}) {
  const key = speechKey();
  const engine = key ? `azure:${VOICE}` : "windows";
  const stamp = join(voiceDir, "narration.json");
  const script = JSON.stringify({ engine, lines: NARRATION });
  const stale =
    force || !existsSync(stamp) || readFileSync(stamp, "utf8") !== script;

  if (stale) {
    rmSync(voiceDir, { recursive: true, force: true });
    mkdirSync(voiceDir, { recursive: true });
    if (key) {
      await renderWithAzure();
    } else {
      const manifest = join(voiceDir, "lines.json");
      writeFileSync(manifest, JSON.stringify(NARRATION), "utf8");
      renderWithWindows(manifest);
    }
    writeFileSync(stamp, script, "utf8");
  }

  const clips = {};
  for (const line of NARRATION) {
    const file = join(voiceDir, `${line.id}.wav`);
    clips[line.id] = { file, duration: wavSeconds(file) };
  }
  return clips;
}

/**
 * Lays the clips onto the silent video at the timestamps the capture recorded.
 * Cues that ran long are simply left where they started; the beats already
 * reserve enough screen time for them.
 */
export function muxVoice(videoFile, cues, outFile) {
  const used = cues.filter((cue) => cue.file && existsSync(cue.file));
  if (!used.length) {
    return false;
  }

  const inputs = [];
  const filters = [];
  const labels = [];
  used.forEach((cue, index) => {
    inputs.push("-i", cue.file);
    const ms = Math.max(0, Math.round(cue.at * 1000));
    const label = `a${index}`;
    // Stereo out, so both channels need the same delay.
    filters.push(
      `[${index + 1}:a]aresample=48000,adelay=${ms}|${ms},aformat=channel_layouts=stereo[${label}]`
    );
    labels.push(`[${label}]`);
  });
  filters.push(
    `${labels.join("")}amix=inputs=${used.length}:normalize=0:dropout_transition=0[mix]`
  );

  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      videoFile,
      ...inputs,
      "-filter_complex",
      filters.join(";"),
      "-map",
      "0:v",
      "-map",
      "[mix]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      outFile,
    ],
    { stdio: "ignore" }
  );
  return true;
}

if (process.argv[1] && process.argv[1].endsWith("voiceover.mjs")) {
  const clips = await renderVoice({ force: process.argv.includes("--force") });
  let total = 0;
  for (const line of NARRATION) {
    const seconds = clips[line.id].duration;
    total += seconds;
    console.log(`${line.id.padEnd(10)} ${seconds.toFixed(1)}s`);
  }
  console.log(`total      ${total.toFixed(1)}s of narration`);
}

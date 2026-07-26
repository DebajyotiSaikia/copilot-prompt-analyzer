// One-off security scan of everything git actually tracks.
//   node scripts/secret-scan.mjs
import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";

const BINARY = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".mp4",
  ".ico",
  ".woff",
  ".woff2",
  ".zip",
  ".vsix",
]);

const RULES = [
  {
    id: "azure-key",
    re: /\b[A-Za-z0-9]{32,84}\b/g,
    check: (m) =>
      /[0-9]/.test(m) && /[A-Za-z]/.test(m) && entropy(m) > 3.6 && !ordered(m),
    note: "high-entropy string (possible API key)",
  },
  {
    id: "user-path",
    re: /C:\\+Users\\+[A-Za-z0-9._-]+/gi,
    note: "local user path",
  },
  {
    id: "home-path",
    re: /\/(?:home|Users)\/[A-Za-z0-9._-]+/g,
    note: "local home path",
  },
  {
    id: "cog-endpoint",
    re: /https:\/\/[A-Za-z0-9-]+\.(?:cognitiveservices|services\.ai|openai)\.azure\.com/gi,
    note: "Azure resource endpoint",
  },
  {
    id: "guid",
    re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    note: "GUID (subscription/tenant?)",
  },
  {
    id: "email",
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    note: "email address",
  },
  {
    id: "bearer",
    re: /\b(?:ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g,
    note: "JWT",
  },
  {
    id: "pat",
    re: /\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}/g,
    note: "GitHub token",
  },
  { id: "aws", re: /\bAKIA[0-9A-Z]{16}\b/g, note: "AWS access key id" },
  {
    id: "pkey",
    re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
    note: "private key",
  },
  {
    id: "assign",
    re: /\b(?:api[_-]?key|secret|password|passwd|token|client[_-]?secret|connection[_-]?string)\b\s*[:=]\s*["'][^"'\n]{8,}["']/gi,
    note: "assigned credential",
  },
];

// Lock files are wall-to-wall base64 integrity hashes; entropy scanning them is
// pure noise. Every other rule still applies to them.
const NO_ENTROPY = /package-lock\.json$|\.map$/;

/**
 * Character-set alphabets (nonce tables, base62 strings) score high on entropy
 * but are just runs of consecutive code points. A key never looks like that.
 */
function ordered(value) {
  let runs = 0;
  let run = 1;
  for (let i = 1; i < value.length; i++) {
    if (value.charCodeAt(i) === value.charCodeAt(i - 1) + 1) {
      run += 1;
    } else {
      runs = Math.max(runs, run);
      run = 1;
    }
  }
  return Math.max(runs, run) >= 8;
}

function entropy(value) {
  const counts = new Map();
  for (const ch of value) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

const files = execSync("git ls-files", { encoding: "utf8" })
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

let findings = 0;
let scanned = 0;
const skipped = [];

for (const file of files) {
  if (BINARY.has(extname(file).toLowerCase())) {
    skipped.push(file);
    continue;
  }
  if (statSync(file).size > 4_000_000) {
    skipped.push(file);
    continue;
  }
  const text = readFileSync(file, "utf8");
  scanned += 1;
  const lines = text.split("\n");

  for (const rule of RULES) {
    if (rule.id === "azure-key" && NO_ENTROPY.test(file)) {
      continue;
    }
    lines.forEach((line, index) => {
      const matches = line.match(rule.re);
      if (!matches) {
        return;
      }
      for (const match of new Set(matches)) {
        if (rule.check && !rule.check(match)) {
          continue;
        }
        findings += 1;
        console.log(
          `${file}:${index + 1}  [${rule.id}] ${rule.note}\n    ${match.slice(0, 90)}`
        );
      }
    });
  }
}

console.log(
  `\nscanned ${scanned} text files, skipped ${skipped.length} binary/large, ${findings} finding(s)`
);
if (skipped.length) {
  console.log("skipped: " + skipped.join(", "));
}

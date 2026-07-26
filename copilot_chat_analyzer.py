#!/usr/bin/env python3
"""copilot-prompt-analyzer - index and analyze GitHub Copilot Chat history.

VS Code persists every chat panel session as JSON on disk. This tool reads those
files (read-only), extracts each user prompt plus its metadata, and stores them
in a local SQLite database with full-text search.

Sources scanned:
  <userdir>/workspaceStorage/<hash>/chatSessions/*.json
  <userdir>/globalStorage/emptyWindowChatSessions/*.json
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sqlite3
import sys
import urllib.parse
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_DB = HERE / "copilot-chats.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id              TEXT PRIMARY KEY,
    source_file     TEXT NOT NULL,
    workspace       TEXT,
    workspace_hash  TEXT,
    location        TEXT,
    created_at      TEXT,
    last_message_at TEXT,
    prompt_count    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS prompts (
    id           INTEGER PRIMARY KEY,
    session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    seq          INTEGER NOT NULL,
    request_id   TEXT,
    ts           TEXT,
    workspace    TEXT,
    model        TEXT,
    model_label  TEXT,
    model_key    TEXT,
    mode         TEXT,
    command      TEXT,
    text         TEXT NOT NULL,
    chars        INTEGER NOT NULL,
    words        INTEGER NOT NULL,
    refs         TEXT,
    tools        TEXT,
    tool_calls   INTEGER NOT NULL DEFAULT 0,
    elapsed_ms   INTEGER,
    reply        TEXT,
    UNIQUE (session_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_prompts_ts        ON prompts(ts);
CREATE INDEX IF NOT EXISTS idx_prompts_workspace ON prompts(workspace);
CREATE INDEX IF NOT EXISTS idx_prompts_model     ON prompts(model);
CREATE INDEX IF NOT EXISTS idx_prompts_session   ON prompts(session_id);
"""

FTS_SCHEMA = """
CREATE VIRTUAL TABLE IF NOT EXISTS prompts_fts
USING fts5(text, content='prompts', content_rowid='id', tokenize='porter unicode61');
"""


# --------------------------------------------------------------------------
# locating VS Code user data
# --------------------------------------------------------------------------

def default_user_dirs() -> list[Path]:
    """Candidate VS Code `User` directories for the current platform."""
    names = ["Code", "Code - Insiders", "VSCodium"]
    roots: list[Path] = []
    if sys.platform.startswith("win"):
        appdata = os.environ.get("APPDATA")
        if appdata:
            roots = [Path(appdata) / n for n in names]
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
        roots = [base / n for n in names]
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
        roots = [base / n for n in names]
    return [r / "User" for r in roots if (r / "User").is_dir()]


def uri_to_path(uri: str | None) -> str | None:
    """Turn a `file:///c%3A/Projects/Foo` URI into a readable path."""
    if not uri:
        return None
    if not uri.startswith("file://"):
        return uri
    path = urllib.parse.unquote(uri[len("file://"):]).lstrip("/")
    return path.replace("/", os.sep) if os.sep == "\\" else "/" + path


def workspace_of(storage_dir: Path) -> str | None:
    meta = storage_dir / "workspace.json"
    if not meta.is_file():
        return None
    try:
        data = json.loads(meta.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    folder = data.get("folder")
    if not folder:
        config = data.get("configuration")
        folder = config.get("path") if isinstance(config, dict) else config
    return uri_to_path(folder)


def discover_sessions(user_dir: Path):
    """Yield (session_file, workspace_label, workspace_hash).

    VS Code wrote one JSON document per session until Feb 2026 and an
    append-only ``.jsonl`` log after that. Both still exist on disk.
    """
    patterns = ("*.json", "*.jsonl")
    ws_root = user_dir / "workspaceStorage"
    if ws_root.is_dir():
        for storage_dir in sorted(ws_root.iterdir()):
            chat_dir = storage_dir / "chatSessions"
            if not chat_dir.is_dir():
                continue
            label = workspace_of(storage_dir)
            for pattern in patterns:
                for f in sorted(chat_dir.glob(pattern)):
                    yield f, label, storage_dir.name

    empty = user_dir / "globalStorage" / "emptyWindowChatSessions"
    if empty.is_dir():
        for pattern in patterns:
            for f in sorted(empty.glob(pattern)):
                yield f, "(no workspace)", None


# --------------------------------------------------------------------------
# session file readers
# --------------------------------------------------------------------------

# Only these top-level branches are reconstructed; the rest is editor UI state.
KEPT_BRANCHES = {
    "requests",
    "sessionId",
    "creationDate",
    "lastMessageDate",
    "initialLocation",
}


def _apply_patch(root: dict, key: list, value, append: bool) -> None:
    """Apply one ``.jsonl`` patch record at the path given by ``key``."""
    if not key or str(key[0]) not in KEPT_BRANCHES:
        return

    current = root
    for index, segment in enumerate(key[:-1]):
        nxt = None
        if isinstance(current, dict):
            nxt = current.get(segment)
        elif isinstance(current, list) and isinstance(segment, int):
            nxt = current[segment] if 0 <= segment < len(current) else None
        else:
            return

        if not isinstance(nxt, (dict, list)):
            nxt = [] if isinstance(key[index + 1], int) else {}
            if isinstance(current, dict):
                current[segment] = nxt
            elif isinstance(segment, int):
                while len(current) <= segment:
                    current.append(None)
                current[segment] = nxt
            else:
                return
        current = nxt

    last = key[-1]
    if append:
        items = value if isinstance(value, list) else [value]
        if isinstance(current, dict):
            existing = current.get(last)
            current[last] = (existing if isinstance(existing, list) else []) + items
        return

    if isinstance(current, dict):
        current[last] = value
    elif isinstance(current, list) and isinstance(last, int):
        while len(current) <= last:
            current.append(None)
        current[last] = value


def read_jsonl_session(path: Path) -> dict | None:
    """Replay an append-only session log into a single session object.

    Line 0 is a full snapshot; later lines patch it::

        {"kind":0, "v": {...}}                                base snapshot
        {"kind":1, "k":["requests",1,"result"], "v": {...}}   set value at path
        {"kind":2, "k":["requests"], "v":[{...}]}             append at path
    """
    session: dict | None = None
    saw_line = False
    try:
        with path.open("r", encoding="utf-8") as fh:
            for raw in fh:
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    record = json.loads(raw)
                except ValueError:
                    continue  # a torn final line is normal for an append-only log
                if not isinstance(record, dict):
                    continue
                saw_line = True

                if record.get("kind") == 0:
                    base = record.get("v") or {}
                    session = {
                        "sessionId": base.get("sessionId"),
                        "creationDate": base.get("creationDate"),
                        "lastMessageDate": base.get("lastMessageDate"),
                        "initialLocation": base.get("initialLocation"),
                        "requests": base.get("requests") or [],
                    }
                elif session is not None:
                    _apply_patch(
                        session,
                        record.get("k") or [],
                        record.get("v"),
                        record.get("kind") == 2,
                    )
    except OSError:
        return session

    return session if saw_line else None


def read_session(path: Path) -> dict | None:
    if path.suffix == ".jsonl":
        return read_jsonl_session(path)
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


# --------------------------------------------------------------------------
# parsing
# --------------------------------------------------------------------------

def epoch_to_iso(value) -> str | None:
    if not isinstance(value, (int, float)) or value <= 0:
        return None
    return datetime.fromtimestamp(value / 1000, tz=timezone.utc).isoformat(timespec="seconds")


def prompt_text(request: dict) -> str:
    text = request.get("message", {}).get("text")
    if isinstance(text, str) and text.strip():
        return text.strip()
    parts = request.get("message", {}).get("parts") or []
    return "".join(p.get("text", "") for p in parts if isinstance(p, dict)).strip()


def context_refs(request: dict) -> list[str]:
    names = []
    for var in (request.get("variableData") or {}).get("variables") or []:
        if isinstance(var, dict):
            names.append(var.get("name") or var.get("id") or "?")
    for part in request.get("message", {}).get("parts") or []:
        if isinstance(part, dict) and part.get("kind") in {"file", "toolReference", "reference"}:
            names.append(part.get("text") or part.get("id") or "?")
    return sorted({n for n in names if n})


def scan_response(request: dict) -> tuple[list[str], int, str]:
    """Return (distinct tool names, tool call count, assistant reply text)."""
    tools: Counter[str] = Counter()
    chunks: list[str] = []
    for part in request.get("response") or []:
        if not isinstance(part, dict):
            continue
        kind = part.get("kind")
        if kind == "toolInvocationSerialized":
            tools[part.get("toolId") or "unknown"] += 1
        elif kind is None:
            value = part.get("value")
            if isinstance(value, str):
                chunks.append(value)
    return sorted(tools), sum(tools.values()), "".join(chunks).strip()


def mode_of(request: dict) -> str | None:
    agent = request.get("agent") or {}
    modes = agent.get("modes") or []
    if modes:
        return str(modes[0])
    return agent.get("name")


def model_label_of(request: dict) -> str | None:
    details = ((request.get("result") or {}).get("details"))
    if isinstance(details, str) and details:
        return details.split("\u2022")[0].strip() or None
    return None


def model_key_of(label: str | None, model_id: str | None) -> str | None:
    """Collapse 'Claude Haiku 4.5' and 'copilot/claude-haiku-4.5' onto one key."""
    source = label or (model_id or "").split("/")[-1]
    return re.sub(r"[^a-z0-9]", "", source.lower()) or None


def slash_command(text: str) -> str | None:
    m = re.match(r"^/([A-Za-z][\w.-]*)", text)
    return m.group(1) if m else None


def parse_session(path: Path, workspace: str | None, ws_hash: str | None):
    data = read_session(path)
    if data is None:
        return None, [], f"{path.name}: unreadable or empty session file"

    requests = data.get("requests") or []
    session_id = data.get("sessionId") or path.stem
    session = {
        "id": session_id,
        "source_file": str(path),
        "workspace": workspace,
        "workspace_hash": ws_hash,
        "location": data.get("initialLocation"),
        "created_at": epoch_to_iso(data.get("creationDate")),
        "last_message_at": epoch_to_iso(data.get("lastMessageDate")),
        "prompt_count": 0,
    }

    rows = []
    for seq, request in enumerate(requests):
        if not isinstance(request, dict):
            continue
        text = prompt_text(request)
        if not text:
            continue
        tools, tool_calls, reply = scan_response(request)
        label, model_id = model_label_of(request), request.get("modelId")
        rows.append({
            "session_id": session_id,
            "seq": seq,
            "request_id": request.get("requestId"),
            "ts": epoch_to_iso(request.get("timestamp")) or session["created_at"],
            "workspace": workspace,
            "model": model_id,
            "model_label": label,
            "model_key": model_key_of(label, model_id),
            "mode": mode_of(request),
            "command": slash_command(text),
            "text": text,
            "chars": len(text),
            "words": len(text.split()),
            "refs": json.dumps(context_refs(request)),
            "tools": json.dumps(tools),
            "tool_calls": tool_calls,
            "elapsed_ms": ((request.get("result") or {}).get("timings") or {}).get("totalElapsed"),
            "reply": reply[:4000],
        })

    session["prompt_count"] = len(rows)
    return session, rows, None


# --------------------------------------------------------------------------
# database
# --------------------------------------------------------------------------

def connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    try:
        conn.executescript(FTS_SCHEMA)
    except sqlite3.OperationalError:
        pass  # FTS5 unavailable; search falls back to LIKE
    return conn


def has_fts(conn: sqlite3.Connection) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE name = 'prompts_fts'").fetchone()
    return row is not None


def cmd_index(args) -> int:
    user_dirs = [Path(p) for p in args.user_dir] if args.user_dir else default_user_dirs()
    if not user_dirs:
        print("No VS Code user directory found. Pass --user-dir explicitly.", file=sys.stderr)
        return 1

    db_path = Path(args.db)
    if args.rebuild and db_path.exists():
        db_path.unlink()
    conn = connect(db_path)

    files = errors = sessions = prompts = 0
    with conn:
        for user_dir in user_dirs:
            print(f"scanning {user_dir}")
            for path, workspace, ws_hash in discover_sessions(user_dir):
                files += 1
                session, rows, err = parse_session(path, workspace, ws_hash)
                if err:
                    errors += 1
                    print(f"  skipped {err}", file=sys.stderr)
                    continue
                if not rows:
                    continue
                conn.execute(
                    """INSERT INTO sessions
                           (id, source_file, workspace, workspace_hash, location,
                            created_at, last_message_at, prompt_count)
                       VALUES (:id, :source_file, :workspace, :workspace_hash, :location,
                               :created_at, :last_message_at, :prompt_count)
                       ON CONFLICT(id) DO UPDATE SET
                           source_file=excluded.source_file,
                           workspace=excluded.workspace,
                           last_message_at=excluded.last_message_at,
                           prompt_count=excluded.prompt_count""",
                    session)
                conn.executemany(
                    """INSERT INTO prompts
                           (session_id, seq, request_id, ts, workspace, model, model_label,
                            model_key, mode, command, text, chars, words, refs, tools,
                            tool_calls, elapsed_ms, reply)
                       VALUES (:session_id, :seq, :request_id, :ts, :workspace, :model,
                               :model_label, :model_key, :mode, :command, :text, :chars,
                               :words, :refs, :tools, :tool_calls, :elapsed_ms, :reply)
                       ON CONFLICT(session_id, seq) DO UPDATE SET
                           text=excluded.text, reply=excluded.reply,
                           tools=excluded.tools, tool_calls=excluded.tool_calls""",
                    rows)
                sessions += 1
                prompts += len(rows)

    if has_fts(conn):
        with conn:
            conn.execute("INSERT INTO prompts_fts(prompts_fts) VALUES('rebuild')")
    conn.close()

    print(f"\nfiles seen: {files}   sessions with prompts: {sessions}   "
          f"prompts indexed: {prompts}   errors: {errors}")
    print(f"database: {db_path}")
    return 0


# --------------------------------------------------------------------------
# reporting helpers
# --------------------------------------------------------------------------

def filters(args) -> tuple[str, list]:
    where, params = [], []
    if getattr(args, "workspace", None):
        where.append("workspace LIKE ?")
        params.append(f"%{args.workspace}%")
    if getattr(args, "model", None):
        where.append("(model LIKE ? OR model_label LIKE ?)")
        params += [f"%{args.model}%", f"%{args.model}%"]
    if getattr(args, "mode", None):
        where.append("mode = ?")
        params.append(args.mode)
    if getattr(args, "since", None):
        where.append("ts >= ?")
        params.append(args.since)
    if getattr(args, "until", None):
        where.append("ts <= ?")
        params.append(args.until)
    return (" AND ".join(where) or "1=1"), params


def one_line(text: str, width: int) -> str:
    flat = re.sub(r"\s+", " ", text).strip()
    return flat if len(flat) <= width else flat[: width - 1] + "\u2026"


def print_rows(rows, width: int) -> None:
    for r in rows:
        stamp = (r["ts"] or "")[:16].replace("T", " ")
        tag = r["model_label"] or r["model"] or "?"
        ws = Path(r["workspace"]).name if r["workspace"] else "-"
        print(f"{stamp:<16}  {ws:<22.22}  {tag:<20.20}  {one_line(r['text'], width)}")


def cmd_list(args) -> int:
    conn = connect(Path(args.db))
    clause, params = filters(args)
    rows = conn.execute(
        f"SELECT * FROM prompts WHERE {clause} ORDER BY ts DESC LIMIT ?",
        params + [args.limit]).fetchall()
    print_rows(rows, args.width)
    print(f"\n{len(rows)} prompt(s)")
    return 0


def cmd_search(args) -> int:
    conn = connect(Path(args.db))
    clause, params = filters(args)
    if has_fts(conn) and not args.like:
        sql = (f"SELECT p.* FROM prompts_fts f JOIN prompts p ON p.id = f.rowid "
               f"WHERE prompts_fts MATCH ? AND {clause} "
               f"ORDER BY p.ts DESC LIMIT ?")
        args_list = [args.query] + params + [args.limit]
    else:
        sql = (f"SELECT * FROM prompts WHERE text LIKE ? AND {clause} "
               f"ORDER BY ts DESC LIMIT ?")
        args_list = [f"%{args.query}%"] + params + [args.limit]
    try:
        rows = conn.execute(sql, args_list).fetchall()
    except sqlite3.OperationalError as exc:
        print(f"query error: {exc}\n(hint: use --like for plain substring search)",
              file=sys.stderr)
        return 1
    print_rows(rows, args.width)
    print(f"\n{len(rows)} match(es)")
    return 0


def cmd_session(args) -> int:
    conn = connect(Path(args.db))
    meta = conn.execute(
        "SELECT * FROM sessions WHERE id LIKE ?", (f"{args.session_id}%",)).fetchone()
    if not meta:
        print("no such session", file=sys.stderr)
        return 1
    print(f"session   {meta['id']}")
    print(f"workspace {meta['workspace']}")
    print(f"started   {meta['created_at']}    prompts: {meta['prompt_count']}")
    print(f"file      {meta['source_file']}\n")
    for r in conn.execute(
            "SELECT * FROM prompts WHERE session_id = ? ORDER BY seq", (meta["id"],)):
        print(f"--- #{r['seq']}  {r['ts']}  [{r['model_label'] or r['model']}] "
              f"{r['tool_calls']} tool call(s)")
        print(r["text"], "\n")
    return 0


def table(title: str, rows, label_width: int = 40) -> None:
    print(f"\n{title}")
    print("-" * (label_width + 12))
    for name, count in rows:
        print(f"{str(name or '-'):<{label_width}.{label_width}} {count:>8}")


def cmd_stats(args) -> int:
    conn = connect(Path(args.db))
    clause, params = filters(args)
    base = f"FROM prompts WHERE {clause}"

    total = conn.execute(f"SELECT COUNT(*) c, SUM(words) w, AVG(chars) a, "
                         f"MIN(ts) lo, MAX(ts) hi {base}", params).fetchone()
    if not total["c"]:
        print("No prompts indexed. Run `index` first.")
        return 0
    n_sessions = conn.execute(
        f"SELECT COUNT(DISTINCT session_id) c {base}", params).fetchone()["c"]

    print("Copilot Chat prompt statistics")
    print("=" * 52)
    print(f"prompts            {total['c']}")
    print(f"sessions           {n_sessions}")
    print(f"words typed        {total['w'] or 0}")
    print(f"avg prompt length  {total['a']:.0f} chars")
    print(f"date range         {(total['lo'] or '?')[:10]}  ->  {(total['hi'] or '?')[:10]}")

    def group(expr, limit=15):
        return conn.execute(
            f"SELECT {expr} k, COUNT(*) c {base} GROUP BY k ORDER BY c DESC LIMIT ?",
            params + [limit]).fetchall()

    table("Prompts per workspace", [(Path(r["k"]).name if r["k"] else "-", r["c"])
                                    for r in group("workspace")])
    table("Prompts per model", [(r["name"], r["c"]) for r in conn.execute(
        f"SELECT COALESCE(MAX(model_label), MAX(model)) name, COUNT(*) c {base} "
        f"GROUP BY model_key ORDER BY c DESC", params)])
    table("Prompts per mode", [(r["k"], r["c"]) for r in group("mode")])
    table("Slash commands used", [(f"/{r['k']}", r["c"]) for r in group("command") if r["k"]])
    table("Prompts per month", [(r["k"], r["c"]) for r in conn.execute(
        f"SELECT substr(ts,1,7) k, COUNT(*) c {base} GROUP BY k ORDER BY k", params)])

    tools: Counter[str] = Counter()
    for (blob,) in conn.execute(f"SELECT tools {base}", params):
        tools.update(json.loads(blob or "[]"))
    table("Most used tools", tools.most_common(15))

    openers: Counter[str] = Counter()
    for (text,) in conn.execute(f"SELECT text {base}", params):
        words = re.findall(r"[A-Za-z']+", text.lower())[:3]
        if len(words) == 3:
            openers[" ".join(words)] += 1
    table("Most common openings", [(k, v) for k, v in openers.most_common(15) if v > 1])

    print("\nLongest prompts")
    print("-" * 52)
    print_rows(conn.execute(
        f"SELECT * {base} ORDER BY chars DESC LIMIT 5", params).fetchall(), 90)
    return 0


def cmd_export(args) -> int:
    conn = connect(Path(args.db))
    clause, params = filters(args)
    rows = conn.execute(
        f"SELECT * FROM prompts WHERE {clause} ORDER BY ts", params).fetchall()
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    if args.format == "jsonl":
        with out.open("w", encoding="utf-8") as fh:
            for r in rows:
                fh.write(json.dumps(dict(r), ensure_ascii=False) + "\n")
    elif args.format == "csv":
        cols = ["ts", "workspace", "model_label", "model", "mode", "command",
                "chars", "words", "tool_calls", "session_id", "text"]
        with out.open("w", encoding="utf-8", newline="") as fh:
            writer = csv.writer(fh)
            writer.writerow(cols)
            for r in rows:
                writer.writerow([r[c] for c in cols])
    else:  # md
        with out.open("w", encoding="utf-8") as fh:
            fh.write("# Copilot Chat prompts\n")
            current = None
            for r in rows:
                if r["session_id"] != current:
                    current = r["session_id"]
                    fh.write(f"\n## {r['workspace'] or '(no workspace)'} "
                             f"- {(r['ts'] or '')[:10]}\n\n")
                fh.write(f"- `{(r['ts'] or '')[:16]}` **{r['model_label'] or r['model']}** - "
                         f"{one_line(r['text'], 400)}\n")

    print(f"wrote {len(rows)} prompt(s) to {out}")
    return 0


# --------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="copilot-prompt-analyzer",
        description="Index and analyze GitHub Copilot Chat prompts stored by VS Code.")
    parser.add_argument("--db", default=str(DEFAULT_DB), help="SQLite database path")
    sub = parser.add_subparsers(dest="command", required=True)

    def add_filters(p, with_limit=True):
        p.add_argument("--workspace", help="substring match on workspace path")
        p.add_argument("--model", help="substring match on model id/name")
        p.add_argument("--mode", help="exact mode (agent, ask, edit, ...)")
        p.add_argument("--since", help="ISO date lower bound, e.g. 2026-01-01")
        p.add_argument("--until", help="ISO date upper bound")
        if with_limit:
            p.add_argument("-n", "--limit", type=int, default=40)
            p.add_argument("--width", type=int, default=100, help="prompt preview width")

    p = sub.add_parser("index", help="scan VS Code storage and (re)build the database")
    p.add_argument("--user-dir", action="append",
                   help="explicit VS Code 'User' directory (repeatable)")
    p.add_argument("--rebuild", action="store_true", help="delete the database first")
    p.set_defaults(func=cmd_index)

    p = sub.add_parser("stats", help="summary of how you prompt")
    add_filters(p, with_limit=False)
    p.set_defaults(func=cmd_stats)

    p = sub.add_parser("list", help="most recent prompts")
    add_filters(p)
    p.set_defaults(func=cmd_list)

    p = sub.add_parser("search", help="full-text search across prompts")
    p.add_argument("query")
    p.add_argument("--like", action="store_true", help="plain substring instead of FTS")
    add_filters(p)
    p.set_defaults(func=cmd_search)

    p = sub.add_parser("session", help="print every prompt in one session")
    p.add_argument("session_id", help="full or leading part of the session id")
    p.set_defaults(func=cmd_session)

    p = sub.add_parser("export", help="export prompts to a file")
    p.add_argument("--format", choices=["jsonl", "csv", "md"], default="jsonl")
    p.add_argument("--out", default="prompts.jsonl")
    add_filters(p, with_limit=False)
    p.set_defaults(func=cmd_export)

    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)

#!/usr/bin/env python3
"""
claude-activity-ping.py — a Claude Code hook that reports "developing
right now" activity to the sankhacooray.com analytics proxy.

Wired into ~/.claude/settings.json on three events:
  SessionStart  -> register a session / refresh the live dot
  Stop          -> read the session transcript, sum tokens, report totals
  SessionEnd    -> mark the session ended (drops the live dot at once)

Claude Code passes the hook a JSON object on stdin that includes
`hook_event_name`, `session_id`, and `transcript_path`. The transcript is
a local JSONL file whose assistant turns carry per-message `usage` — so we
recover token counts entirely on-disk, with NO API key and regardless of
whether Claude runs on a subscription or API billing.

Nothing here ever sends a project name, file path, or transcript content —
only the session id, the event, and rolled-up token totals.

Config — first match wins:
  env CLAUDE_ACTIVITY_PROXY_URL / CLAUDE_ACTIVITY_TOKEN, else
  ~/.claude/claude-activity.json  -> { "proxyUrl": "...", "token": "..." }

The hook is fire-and-forget: any failure (no config, network down, bad
JSON) exits 0 silently so it can never block or slow a Claude session.
"""

import json
import os
import sys
import urllib.request

CONFIG_PATH = os.path.expanduser("~/.claude/claude-activity.json")
TOKEN_EVENTS = ("Stop", "SubagentStop", "SessionEnd")


def load_config():
    cfg = {}
    try:
        with open(CONFIG_PATH) as f:
            cfg = json.load(f)
    except Exception:
        pass
    url = os.environ.get("CLAUDE_ACTIVITY_PROXY_URL") or cfg.get("proxyUrl", "")
    token = os.environ.get("CLAUDE_ACTIVITY_TOKEN") or cfg.get("token", "")
    return url, token


def read_stdin():
    try:
        return json.load(sys.stdin)
    except Exception:
        return {}


def sum_tokens(transcript_path):
    """Cumulative tokens for the whole session so far.

    in  = newly-ingested context (input + cache-creation), summed per turn.
    out = generated tokens.
    Cache *reads* are deliberately excluded — they re-count the same cached
    prefix on every turn and would balloon the figure into nonsense.
    """
    t_in = t_out = 0
    try:
        with open(transcript_path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                usage = (obj.get("message") or {}).get("usage") or {}
                if not usage:
                    continue
                t_in += usage.get("input_tokens", 0) or 0
                t_in += usage.get("cache_creation_input_tokens", 0) or 0
                t_out += usage.get("output_tokens", 0) or 0
    except Exception:
        pass
    return t_in, t_out


def main():
    url, token = load_config()
    if not url or not token:
        return

    data = read_stdin()
    session_id = data.get("session_id", "")
    if not session_id:
        return

    event = data.get("hook_event_name", "")
    payload = {"token": token, "event": event, "sessionId": session_id}

    if event in TOKEN_EVENTS:
        transcript = data.get("transcript_path", "")
        if transcript:
            t_in, t_out = sum_tokens(transcript)
            payload["tokensIn"] = t_in
            payload["tokensOut"] = t_out

    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        # Apps Script processes the POST before its 302 redirect, so the
        # write lands even though we don't read the response body.
        urllib.request.urlopen(req, timeout=3).read()
    except Exception:
        pass


if __name__ == "__main__":
    main()

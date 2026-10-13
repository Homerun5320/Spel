#!/usr/bin/env bash
# SessionStart hook: prints exactly ONE health line and always exits 0.
# Runs `npm ci` only when node_modules is missing or package-lock.json is newer (timeout 90 s).
# Anything noisy goes to .claude/hook.log (gitignored), never to stdout.
set +e
cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}" 2>/dev/null || { echo "session-start: cannot cd to project"; exit 0; }
mkdir -p .claude 2>/dev/null
LOG=.claude/hook.log
log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$LOG" 2>/dev/null; }

node_v=$(node --version 2>>"$LOG" || echo "none")

chromium_path=""
for candidate in "${CHROMIUM_PATH:-}" /opt/pw-browsers/chromium-1194/chrome-linux/chrome; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then chromium_path="$candidate"; break; fi
done

ci_done="nej"
need_install=0
if [ -f package.json ] && [ -f package-lock.json ]; then
  if [ ! -d node_modules ]; then
    need_install=1
  elif [ package-lock.json -nt node_modules/.package-lock.json ]; then
    need_install=1
  fi
  if [ "$need_install" = "1" ]; then
    log "running npm ci"
    if timeout 90 npm ci --prefer-offline --no-audit --no-fund >>"$LOG" 2>&1; then
      ci_done="ja"
    else
      log "npm ci failed or timed out (exit $?)"
      ci_done="nej (failed, see .claude/hook.log)"
    fi
  fi
fi

if [ -n "$chromium_path" ]; then chromium_report="ja ($chromium_path)"; else chromium_report="nej"; fi
echo "session-start: node ${node_v} | chromium ${chromium_report} | npm ci gjord ${ci_done}"
exit 0

#!/usr/bin/env bash
#
# Reports GitHub Actions results from the command line.
#
# Uses the public REST API with no authentication, which works because this
# repository is public. Run-level and step-level results are all visible that
# way; only raw log download requires a token (the API returns 403), so a failure
# is located to the step and then reproduced locally.
#
# Usage:
#   ./scripts/ci-status.sh              # last 10 runs
#   ./scripts/ci-status.sh 5            # last 5 runs
#   ./scripts/ci-status.sh watch        # poll until the newest run finishes
#
# With `gh` installed and authenticated, full logs are available too:
#   gh run list
#   gh run view --log-failed

set -euo pipefail

REPO="${WAYPOINT_REPO:-Scott123180/waypoint}"
API="https://api.github.com/repos/${REPO}"

runs() {
  local limit="${1:-10}"
  curl -sf "${API}/actions/runs?per_page=${limit}" | python3 -c '
import sys, json
d = json.load(sys.stdin)
runs = d.get("workflow_runs", [])
if not runs:
    print("no runs found")
    raise SystemExit
print(f"{'"'"'run'"'"':>5}  {'"'"'workflow'"'"':<10} {'"'"'branch'"'"':<22} {'"'"'status'"'"':<12} {'"'"'result'"'"'}")
for r in runs:
    print(f"{r['"'"'run_number'"'"']:>5}  {r['"'"'name'"'"'][:10]:<10} {(r['"'"'head_branch'"'"'] or '"'"'-'"'"')[:22]:<22} "
          f"{r['"'"'status'"'"']:<12} {r.get('"'"'conclusion'"'"') or '"'"'-'"'"'}")
'
}

# Prints every step of the newest run, marking the ones that failed. This is the
# part that matters: it says *which* step broke without needing log access.
detail() {
  local id
  id=$(curl -sf "${API}/actions/runs?per_page=1" \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["workflow_runs"][0]["id"])')

  curl -sf "${API}/actions/runs/${id}/jobs" | python3 -c '
import sys, json
d = json.load(sys.stdin)
for j in d.get("jobs", []):
    print(f"\n{j['"'"'name'"'"']}: {j['"'"'status'"'"']} / {j.get('"'"'conclusion'"'"') or '"'"'-'"'"'}")
    for s in j.get("steps", []):
        c = s.get("conclusion")
        mark = "FAIL" if c == "failure" else ("ok" if c == "success" else (c or "..."))
        print(f"   [{mark:^7}] {s['"'"'name'"'"']}")
'
  echo
  echo "Full logs need auth. Reproduce a failing step locally instead:"
  echo "  git clone . /tmp/ci-repro && cd /tmp/ci-repro && npm ci && npm run typecheck"
}

watch_run() {
  while :; do
    local status
    status=$(curl -sf "${API}/actions/runs?per_page=1" \
      | python3 -c 'import sys,json;print(json.load(sys.stdin)["workflow_runs"][0]["status"])')
    if [[ "${status}" == "completed" ]]; then
      detail
      return
    fi
    echo "run is ${status}; checking again in 20s"
    sleep 20
  done
}

case "${1:-}" in
  watch) watch_run ;;
  "")    runs 10; detail ;;
  *)     runs "$1" ;;
esac

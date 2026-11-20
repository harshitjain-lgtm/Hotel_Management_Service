#!/usr/bin/env bash
# Day-to-day operations on the deployed HMS. Needs the AWS Session Manager plugin for exec commands.
#
#   bash infra/ops.sh status        service state, health, last log lines
#   bash infra/ops.sh logs [15m]    tail CloudWatch logs (events shipped to STAYSEC show as [event] lines)
#   bash infra/ops.sh seed-output   copy the cloud demo secrets (MFA seeds, partner keys) to backend/data/seed_output.cloud.json
#   bash infra/ops.sh reseed        wipe and re-seed the cloud database (clean demo state) and fetch the new secrets
#   bash infra/ops.sh shell         interactive shell in the running container
set -euo pipefail
source "$(dirname "$0")/config.sh"

task_arn() { $AWS ecs list-tasks --cluster "$ECS_CLUSTER" --service-name "$ECS_SERVICE" --query 'taskArns[0]' --output text; }
exec_cmd() { $AWS ecs execute-command --cluster "$ECS_CLUSTER" --task "$(task_arn)" --container api --interactive --command "$1"; }

case "${1:-status}" in
  status)
    $AWS ecs describe-services --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE" \
      --query 'services[0].[status,runningCount,deployments[0].rolloutState,events[0].message]' --output text
    curl -fsS "$PUBLIC_URL/api/health"; echo
    $AWS logs tail "$LOG_GROUP" --since 10m --format short | grep -v '\[event\]' | tail -5 ;;
  logs)
    $AWS logs tail "$LOG_GROUP" --since "${2:-15m}" --format short ;;
  seed-output)
    out="$REPO_ROOT/backend/data/seed_output.cloud.json"
    exec_cmd "cat data/seed_output.json" > "$out.raw"
    "$REPO_ROOT/backend/.venv/Scripts/python" -c "import json,sys; r=open(sys.argv[1],encoding='utf-8',errors='replace').read(); json.dump(json.loads(r[r.index('{'):r.rindex('}')+1]), open(sys.argv[2],'w'), indent=2)" "$out.raw" "$out" \
      || python3 -c "import json,sys; r=open(sys.argv[1],encoding='utf-8',errors='replace').read(); json.dump(json.loads(r[r.index('{'):r.rindex('}')+1]), open(sys.argv[2],'w'), indent=2)" "$out.raw" "$out"
    rm -f "$out.raw"; echo "wrote $out (gitignored)" ;;
  reseed)
    # Re-seed inside the running container (same data, fresh state, new MFA secrets), then fetch the new secrets.
    exec_cmd "python -m scripts.seed --reset"
    "$0" seed-output ;;
  shell)
    exec_cmd "sh" ;;
  *) sed -n '2,9p' "$0" ;;
esac

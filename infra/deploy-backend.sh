#!/usr/bin/env bash
# Build the backend image, push it to ECR and roll the ECS service. Usage: bash infra/deploy-backend.sh
set -euo pipefail
source "$(dirname "$0")/config.sh"

TAG="build-$(date +%Y%m%d-%H%M%S)-$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
$AWS ecr get-login-password | docker login --username AWS --password-stdin "${ECR_URI%%/*}" >/dev/null
docker build --platform linux/amd64 -t "$ECR_URI:$TAG" -t "$ECR_URI:latest" "$REPO_ROOT/backend"
docker push "$ECR_URI:$TAG" >/dev/null
docker push "$ECR_URI:latest" >/dev/null
echo "pushed $ECR_URI:$TAG"

$AWS ecs update-service --cluster "$ECS_CLUSTER" --service "$ECS_SERVICE" --task-definition "$ECS_SERVICE" --force-new-deployment \
  --query 'service.deployments[0].id' --output text
echo "waiting for the new task to become healthy..."
$AWS ecs wait services-stable --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE"
curl -fsS "$PUBLIC_URL/api/health" && echo && echo "backend deployed"

#!/usr/bin/env bash
# Build the React app from the last COMMIT (not the working folder), upload to S3 and invalidate CloudFront.
# Usage: bash infra/deploy-frontend.sh [git-ref]      (default: HEAD)
#
# Why a clean checkout: uncommitted work in frontend/ (e.g. a redesign in progress) never gets deployed by accident.
# Why .env.production.local: Git Bash rewrites env values like "/api" into "C:/Program Files/Git/api" when it
# starts Windows programs; a file is never rewritten.
set -euo pipefail
source "$(dirname "$0")/config.sh"

REF="${1:-HEAD}"
WORK="$(cd "$(mktemp -d)" && (pwd -W 2>/dev/null || pwd))"   # Windows-style path under Git Bash, so git.exe and bash agree
trap 'git -C "$REPO_ROOT" worktree remove --force "$WORK/src" >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

git -C "$REPO_ROOT" worktree add --detach "$WORK/src" "$REF" >/dev/null
cd "$WORK/src/frontend"
echo "building $(git rev-parse --short HEAD) for $PUBLIC_URL"
printf 'VITE_API_URL=/api\n' > .env.production.local
npm ci --no-audit --no-fund
npm run build

# Refuse to deploy a bundle that would call the wrong API base.
BUNDLE="$(ls dist/assets/index-*.js)"
if grep -qE 'Program Files|[A-Z]:/(Users|Program|Windows)' "$BUNDLE"; then
  echo "ABORT: bundle contains a Windows path as API base"; grep -oE '.{40}(Program Files|[A-Z]:/Users).{20}' "$BUNDLE" | head -3; exit 1
fi
grep -q '"/api"' "$BUNDLE" || { echo 'ABORT: bundle does not use the relative "/api" base'; exit 1; }
echo "bundle check passed: API base is \"/api\""

aws --profile "$AWS_PROFILE_NAME" s3 sync dist/assets "s3://$WEB_BUCKET/assets" \
  --cache-control "public,max-age=31536000,immutable" --only-show-errors
aws --profile "$AWS_PROFILE_NAME" s3 sync dist "s3://$WEB_BUCKET" --exclude "assets/*" --delete \
  --cache-control "no-cache" --only-show-errors
INV=$(aws --profile "$AWS_PROFILE_NAME" cloudfront create-invalidation --distribution-id "$CF_DISTRIBUTION_ID" \
  --paths "/*" --query 'Invalidation.Id' --output text)
aws --profile "$AWS_PROFILE_NAME" cloudfront wait invalidation-completed --distribution-id "$CF_DISTRIBUTION_ID" --id "$INV"

# Confirm CloudFront now serves this exact bundle.
SERVED="$(curl -fsS "$PUBLIC_URL/" | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1)"
[ "$SERVED" = "assets/$(basename "$BUNDLE")" ] || { echo "ABORT: CloudFront serves $SERVED, expected $(basename "$BUNDLE")"; exit 1; }
echo "frontend deployed: $PUBLIC_URL ($SERVED)"

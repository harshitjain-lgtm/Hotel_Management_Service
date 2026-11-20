#!/usr/bin/env bash
# Build the React app for same-origin /api, upload to S3 and invalidate CloudFront. Usage: bash infra/deploy-frontend.sh
set -euo pipefail
source "$(dirname "$0")/config.sh"

cd "$REPO_ROOT/frontend"
npm ci --silent
VITE_API_URL=/api npm run build
# Hashed assets can be cached forever; index.html must always be revalidated.
aws --profile "$AWS_PROFILE_NAME" s3 sync dist/assets "s3://$WEB_BUCKET/assets" --delete \
  --cache-control "public,max-age=31536000,immutable" --only-show-errors
aws --profile "$AWS_PROFILE_NAME" s3 sync dist "s3://$WEB_BUCKET" --exclude "assets/*" --delete \
  --cache-control "no-cache" --only-show-errors
aws --profile "$AWS_PROFILE_NAME" cloudfront create-invalidation --distribution-id "$CF_DISTRIBUTION_ID" \
  --paths "/index.html" "/" --query 'Invalidation.Id' --output text
echo "frontend deployed: $PUBLIC_URL"

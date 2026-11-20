# Shared settings for the StaySec HMS AWS scripts. Source this file; do not run it.
# All commands use an explicit, dedicated AWS CLI profile so nothing falls back to your default credentials.
export MSYS_NO_PATHCONV=1                      # Git Bash on Windows: don't rewrite /paths in AWS arguments

export AWS_PROFILE_NAME="${AWS_PROFILE_NAME:-staysec-hack}"
export REGION="ap-south-1"
export ACCOUNT_ID="072768698904"
export AWS="aws --profile $AWS_PROFILE_NAME --region $REGION"

export ECR_REPO="staysec-hms-api"
export ECR_URI="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/$ECR_REPO"
export ECS_CLUSTER="staysec-hms"
export ECS_SERVICE="staysec-hms-api"
export LOG_GROUP="/ecs/staysec-hms-api"
export WEB_BUCKET="staysec-hms-web-$ACCOUNT_ID"
export CF_DISTRIBUTION_ID="EU1JWQFVDNKOK"
export PUBLIC_URL="https://d8retztu3ojgt.cloudfront.net"
export APP_SECRET_ID="staysec-hms/app"

# pwd -W gives a Windows path under Git Bash (needed because MSYS_NO_PATHCONV is on); plain pwd elsewhere.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && (pwd -W 2>/dev/null || pwd))"
export REPO_ROOT

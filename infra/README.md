# StaySec HMS on AWS

**Live:** https://d8retztu3ojgt.cloudfront.net · API `…/api/*` · STAYSEC action endpoint `…/internal/security/actions`

```
Browser / attack scripts / STAYSEC
        │ HTTPS
        ▼
CloudFront EU1JWQFVDNKOK (d8retztu3ojgt.cloudfront.net)   ← CDN, TLS, single origin for web + API
   ├── default  → S3 staysec-hms-web-072768698904 (private, Origin Access Control) + SPA rewrite function
   └── /api/*, /internal/*, /health → ALB staysec-hms-alb (accepts CloudFront only)
                                         └── ECS Fargate service staysec-hms-api (1 task, 0.5 vCPU / 1 GB)
                                               ├── RDS PostgreSQL 16 staysec-hms-db (private, encrypted, TLS)
                                               ├── Secrets Manager staysec-hms/app
                                               ├── CloudWatch Logs /ecs/staysec-hms-api
                                               └── SQS staysec-hms-events (STAYSEC, us-east-1) via HmsPublisherPolicy
```

Region **ap-south-1 (Mumbai)**, so guest data stays in India. Only PII-free events (guest_refs, field names) cross to the
STAYSEC queue in us-east-1.

## Scripts (Git Bash / Linux / macOS)

All scripts use the dedicated AWS CLI profile `staysec-hack` (override with `AWS_PROFILE_NAME`).

| Command | What it does |
|---|---|
| `bash infra/deploy-backend.sh` | Build image → push to ECR → roll the ECS service → wait until healthy |
| `bash infra/deploy-frontend.sh` | Build React (`VITE_API_URL=/api`) → sync to S3 → invalidate CloudFront |
| `bash infra/ops.sh status` | Service state, health, recent logs |
| `bash infra/ops.sh logs 30m` | Tail logs; `[event] …` lines are the events sent to STAYSEC |
| `bash infra/ops.sh seed-output` | Fetch the cloud demo secrets (MFA seeds, partner keys) into `backend/data/seed_output.cloud.json` (gitignored) |
| `bash infra/ops.sh reseed` | Reset the cloud database to a clean demo state |
| `bash infra/ops.sh shell` | Shell inside the running container (ECS Exec; needs the Session Manager plugin) |

Point the demo tools at the cloud:
```bash
export STAYDESK_URL=https://d8retztu3ojgt.cloudfront.net
export STAYDESK_SEED=backend/data/seed_output.cloud.json
python scenarios/s1_bulk_export.py
python backend/scripts/otp.py --seed backend/data/seed_output.cloud.json admin_01   # current MFA code
```
`demo_control.py` (presets and signed actions) also needs `STAYDESK_SERVICE_KEY` and `STAYSEC_SIGNING_SECRET` from
Secrets Manager `staysec-hms/app`. Never commit those values.

## Runtime configuration (ECS task definition `staysec-hms-api`)

| Variable | Value |
|---|---|
| `EVENT_FORMAT` / `EVENT_SINKS` | `v1` / `sqs,stdout` |
| `SQS_QUEUE_URL` | `https://sqs.us-east-1.amazonaws.com/072768698904/staysec-hms-events` |
| `TRUST_FORWARDED_FOR` | `true` (demo env only, so attack scripts can set `X-Forwarded-For`) |
| `SEED_IF_EMPTY` | `true`: the first boot seeds the empty RDS database |
| `STAYSEC_KEY_ID` | `staysec-1` |
| Secrets (from `staysec-hms/app`) | `DATABASE_URL`, `JWT_SECRET`, `PII_ENCRYPTION_KEY`, `GUEST_REF_KEY`, `STAYSEC_SIGNING_SECRET`, `SERVICE_API_KEY` |

`GUEST_REF_KEY` and `STAYSEC_SIGNING_SECRET` are the shared values from STAYSEC's SSM parameters
(`/staysec/GUEST_REF_KEY`, `/staysec/HMS_SIGNING_SECRET`, us-east-1).

## Resource inventory (all tagged `Project=staysec-hms`)

| Type | Name / ID |
|---|---|
| Security groups (default VPC `vpc-0106a41cb1915122f`) | `staysec-hms-alb-sg` sg-084669c287793fa25 (80 from CloudFront prefix list) · `staysec-hms-task-sg` sg-070a560b997cae95e (8000 from ALB) · `staysec-hms-db-sg` sg-09867f0d1c626c5ba (5432 from tasks) |
| RDS | `staysec-hms-db` (db.t4g.micro, PostgreSQL 16.15, 20 GB gp3, encrypted, private), subnet group `staysec-hms-db-subnets` |
| Secrets Manager | `staysec-hms/app` |
| ECR | `staysec-hms-api` |
| IAM roles | `staysec-hms-task-exec-role` (ECR, logs, read app secret) · `staysec-hms-task-role` (STAYSEC `HmsPublisherPolicy`, ECS Exec) |
| ECS | cluster `staysec-hms`, service `staysec-hms-api`, task family `staysec-hms-api` |
| ALB | `staysec-hms-alb`, target group `staysec-hms-tg` (health `/health`) |
| CloudWatch Logs | `/ecs/staysec-hms-api` (14 days) |
| S3 | `staysec-hms-web-072768698904` (private, OAC-only bucket policy) |
| CloudFront | distribution `EU1JWQFVDNKOK`, OAC `staysec-hms-web-oac`, function `staysec-hms-spa-rewrite` |

Approximate cost: about $50–65/month (RDS micro, one Fargate task, ALB, CloudFront/S3 at demo traffic). **Tear down after the hackathon.**

## Teardown (in this order)

```bash
source infra/config.sh
$AWS ecs update-service --cluster staysec-hms --service staysec-hms-api --desired-count 0
$AWS ecs delete-service --cluster staysec-hms --service staysec-hms-api --force
$AWS ecs delete-cluster --cluster staysec-hms
# CloudFront: disable, wait until Deployed, then delete (needs the ETag)
$AWS elbv2 delete-load-balancer --load-balancer-arn <alb-arn>; $AWS elbv2 delete-target-group --target-group-arn <tg-arn>
$AWS rds delete-db-instance --db-instance-identifier staysec-hms-db --skip-final-snapshot
$AWS ecr delete-repository --repository-name staysec-hms-api --force
$AWS secretsmanager delete-secret --secret-id staysec-hms/app --force-delete-without-recovery
aws --profile staysec-hack s3 rb s3://staysec-hms-web-072768698904 --force
# then: security groups, DB subnet group, IAM roles (detach policies first), log group
```

The STAYSEC stack (`staysec-server`, us-east-1) belongs to the monitoring team. Don't modify or delete it from here.

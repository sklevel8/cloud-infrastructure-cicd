# Operations Runbook

**Service:** `sa-enterprise-prod-api`
**Region:** `af-south-1`
**On-call entry point:** CloudWatch alarm → SNS `sa-enterprise-prod-alerts` (email, plus Chatbot
Slack/Teams once attached)

This runbook assumes `awscli v2` and `jq` are installed and `AWS_PROFILE` points at a role with
read access. Destructive actions require the platform lead.

---

## 1. First five minutes of any incident

```bash
# What is the service doing right now?
aws ecs describe-services --cluster sa-enterprise-prod-cluster \
  --services sa-enterprise-prod-api \
  --query 'services[0].{desired:desiredCount,running:runningCount,pending:pendingCount,events:events[0:8].[createdAt,message]}' \
  --output table

# Which revision is running, and is it the one we meant to ship?
aws ecs describe-services --cluster sa-enterprise-prod-cluster \
  --services sa-enterprise-prod-api --query 'services[0].taskDefinition' --output text

# Are targets healthy?
aws elbv2 describe-target-health \
  --target-group-arn "$(aws elbv2 describe-target-groups \
    --names sa-enterprise-prod-tg --query 'TargetGroups[0].TargetGroupArn' --output text)"

# Recent errors, newest first
aws logs tail /ecs/sa-enterprise-prod/api --since 15m --filter-pattern '{ $.level = "error" }'
```

Decision tree:

| Symptom | Likely cause | Action |
| --- | --- | --- |
| Tasks `RUNNING` but targets unhealthy | Wrong health path, app crash after boot, security group | Check `/health` from inside the task (§3), verify SG rules |
| Tasks cycling (`STOPPED` with exit 1) | Missing secret, bad `PORT`, DB unreachable | Check stopped reason, run §3 |
| `/ready` 503, `/health` 200 | Postgres or Redis unavailable | Check RDS/ElastiCache events; do **not** roll back first — the app is alive |
| 5XX spike right after a deploy | Bad release | Roll back (§4) |
| `wait-for-service-stability` hanging | Circuit breaker cannot stabilise | Pipeline fails and rolls back automatically; confirm |

---

## 2. Daily and weekly checks

```bash
# Alarms not in OK state
aws cloudwatch describe-alarms --state-value ALARM \
  --query 'MetricAlarms[].[AlarmName,StateReason]' --output table

# Service stability over the last day
aws cloudwatch get-metric-statistics --namespace AWS/ECS --metric-name RunningTaskCount \
  --dimensions Name=ClusterName,Value=sa-enterprise-prod-cluster Name=ServiceName,Value=sa-enterprise-prod-api \
  --start-time "$(date -u -d '24 hours ago' +%FT%TZ)" --end-time "$(date -u +%FT%TZ)" \
  --period 3600 --statistics Average
```

Weekly: review the `${project}-${env}-overview` dashboard for latency and 5XX trends, confirm ECR
lifecycle is pruning, and check that the Dependabot PR queue is not stale.

---

## 3. Diagnose a running task

```bash
task_arn="$(aws ecs list-tasks --cluster sa-enterprise-prod-cluster \
  --service-name sa-enterprise-prod-api --query 'taskArns[0]' --output text)"

aws ecs execute-command --cluster sa-enterprise-prod-cluster \
  --task "${task_arn}" --container api-container --interactive \
  --command "/bin/sh"

# inside the task
wget -qO- http://127.0.0.1:3000/health
wget -qO- http://127.0.0.1:3000/ready
node -e "console.log(process.env.DATABASE_URL ? 'url present' : 'url missing')"
```

Never print secret values. `DATABASE_URL` / `REDIS_URL` are resolved at container start; if they are
missing, the task definition lost its `secrets` block.

---

## 4. Deploy, roll back, rotate secrets

### Deploy

Merge to `main`. Watch **Actions → Deploy**. A green run means the stability wait passed, the ALB
smoke test passed and the revision is recorded in the job summary.

### Roll back

```bash
# previous active revision
CLUSTER=sa-enterprise-prod-cluster SERVICE=sa-enterprise-prod-api ./scripts/rollback.sh

# explicit revision
CLUSTER=sa-enterprise-prod-cluster SERVICE=sa-enterprise-prod-api \
  ./scripts/rollback.sh arn:aws:ecs:af-south-1:123456789012:task-definition/sa-enterprise-prod-api:41
```

or **Actions → Rollback → Run workflow** (preferred, because the reason is recorded).

### Rotate the database password

1. `terraform apply` with a new `random_password` (taint the resource:
   `terraform taint random_password.db`).
2. Update the secret version (Terraform does this) and confirm the RDS master password rotated.
3. Force a new deployment so tasks restart with the new secret:
   `aws ecs update-service --cluster ... --service ... --force-new-deployment`.
4. Verify `/ready` returns 200 on every new task before draining the old ones.

Rotating Redis: same pattern with `random_password.redis`; expect a brief cache miss storm, not an
outage.

---

## 5. Patch and dependency maintenance

```bash
# refresh the base image and lockfile
npm update --package-lock-only
npm audit --audit-level=high
npm ci && npm test && npm run lint
docker build -t api:local .
```

Pin the base image digest if supply-chain drift becomes a concern
(`FROM node:24-alpine@sha256:...`). Security patches go out through the normal merge → deploy path.

Terraform provider upgrades: bump `versions.tf`, run `terraform init -upgrade`, then `plan` in CI
before applying.

---

## 6. Restore the database

```bash
aws rds describe-db-snapshots --db-instance-identifier sa-enterprise-prod-postgres \
  --query 'DBSnapshots[-5:].[DBSnapshotIdentifier,SnapshotCreateTime]' --output table

aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier sa-enterprise-prod-postgres \
  --target-db-instance-identifier sa-enterprise-prod-postgres-restore \
  --restore-time "$(date -u -d '30 minutes ago' +%FT%TZ)" \
  --db-subnet-group-name sa-enterprise-prod-db \
  --vpc-security-group-ids <data-sg-id>
```

1. Restore into a **new** identifier; never overwrite the live instance.
2. Point a temporary task at the restored instance to validate data.
3. Once verified, either rename via Terraform (planned change) or export/import the affected rows.
4. Record restore duration in `MAINTENANCE_LOG.md` §3 (target < 30 minutes).

---

## 7. First-deployment acceptance drill

Run once after the first successful apply, and record results in the maintenance log:

1. `curl -sS <alb_url>/health` and `/ready` → both 200.
2. Deploy a no-op change; confirm `RunningTaskCount` never drops below 2.
3. Load test during a deploy: `hey -z 10m -q 500 <alb_url>/health` → 0 non-2xx.
4. Deploy a deliberately broken revision (wrong `PORT`) → confirm automatic rollback and a healthy
   service within 10 minutes.
5. Trigger **Actions → Rollback** manually → confirm the summary records the reason.
6. Force a 5XX spike (temporary `/boom` route behind a flag) → confirm the alarm and SNS delivery.
7. Attempt `psql`/`redis-cli` from a laptop → expect timeout.

---

## 8. Teardown

```bash
# demo account only
cd terraform
terraform destroy -var-file=envs/prod.tfvars
```

`deletion_protection` and `skip_final_snapshot = false` will block a naive destroy. Disable both
deliberately, and confirm the final snapshot exists before removing the database. The state bucket
and lock table are created outside Terraform by `bootstrap-aws.sh` and must be deleted separately.

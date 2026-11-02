# Maintenance Log

**Project:** Cloud Infrastructure & CI/CD Pipeline (Project #4)
**Role:** Project Manager / Release Manager
**Current version:** 1.0.0

The log records every production-affecting change, routine maintenance activity and incident.
Entries are appended, never edited: corrections are new entries.

---

## 1. Release history

| Date | Version | Change | Type | Verified by |
| --- | --- | --- | --- | --- |
| 2026-11-02 | 1.0.0 | Initial release: three-tier VPC, ECS Fargate service, RDS PostgreSQL, ElastiCache, ALB, Terraform remote state, OIDC deploy pipeline, automatic rollback, CloudWatch alarms and dashboard | Feature | Unit suite (33 tests), lint, `terraform validate`; E2E re-run on first apply |

---

## 2. Change log

| Date | Ref | Change | Rationale | Rollback |
| --- | --- | --- | --- | --- |
| 2026-11-02 | CHG-001 | Replaced static AWS access keys with GitHub OIDC role assumption | Removes long-lived credentials from the repository; SRS SR-02 | Re-add repo secrets and the `configure-aws-credentials` key inputs |
| 2026-11-02 | CHG-002 | Added `/ready` drain behaviour on SIGTERM | Ensures the ALB removes a task before the process exits | Revert `src/server.js` shutdown handler |
| 2026-11-02 | CHG-003 | Added VPC interface endpoints (ECR, logs, secrets) and S3 gateway endpoint | Keeps AWS API traffic off NAT, lowers cost and blast radius | Remove `aws_vpc_endpoint` resources and re-apply |
| 2026-11-02 | CHG-004 | Added CPU and request-count autoscaling | Static `desired_count` was the largest availability risk | Remove `aws_appautoscaling_*` resources |
| 2026-11-02 | CHG-005 | Task definition exported from the live service before each render | Prevents CI/Terraform drift on the running revision | Revert to the committed `deploy/task-definition.json` |

---

## 3. Verification and drills

| Date | Activity | Result | Follow-up |
| --- | --- | --- | --- |
| 2026-11-02 | Automated suite (33 tests) | Pass | — |
| 2026-11-02 | `terraform fmt -check` / `terraform validate` | Pass | Run plan in CI on first PR |
| 2026-11-02 | Image build + Trivy scan | Executed in CI | Review findings, pin base image digest if drift appears |
| 2026-11-02 | `terraform plan` idempotency after apply | Pending first apply | Release manager to record output |
| 2026-11-02 | Zero-downtime load test (500 rps during rollout) | Pending first apply | Record p95 and error rate here |
| 2026-11-02 | Automatic rollback drill (bad `PORT`) | Pending first apply | Confirm restored revision ARN |
| 2026-11-02 | Manual rollback drill | Pending first apply | Confirm `rollback.yml` summary |
| 2026-11-02 | RDS snapshot restore into a scratch instance | Pending | Record restore duration (target < 30 min) |
| 2026-11-02 | Secret isolation check from a public IP | Pending | Expect timeout on 5432/6379 |

---

## 4. Routine maintenance schedule

| Cadence | Task | Owner | Reference |
| --- | --- | --- | --- |
| On merge | Dependency PR review (Dependabot) | Platform | `dependabot.yml` |
| Weekly | Review CloudWatch alarm history and dashboard for trends | On-call | RUNBOOK §2 |
| Weekly | Confirm ECR lifecycle is pruning untagged images | Platform | `terraform/ecr.tf` |
| Monthly | Patch base image (`node:24-alpine`) and refresh lockfile | Platform | RUNBOOK §5 |
| Monthly | Verify backup restore into a scratch database | DBA | RUNBOOK §6 |
| Quarterly | Rotate RDS and Redis credentials | Platform | RUNBOOK §4 |
| Quarterly | Review IAM trust policy and `github_subjects` conditions | Security | `terraform/iam.tf` |
| Quarterly | Cost review against SDD §9 model | PM | — |
| Annually | ACM certificate renewal check (if not DNS-validated) | Platform | — |
| Per release | Update `RELEASE_NOTES.md` and this log | Release manager | — |

---

## 5. Incident log

| ID | Date | Severity | Summary | Duration | Root cause | Resolution | Preventive action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| — | — | — | No production incidents recorded for v1.0.0 | — | — | — | — |

### Incident entry template

```
ID:            INC-YYYY-NNN
Detected:      <timestamp UTC> by <alarm | user report | pipeline>
Impact:        <users affected, endpoints, duration>
Timeline:      <detection -> triage -> mitigation -> resolution>
Root cause:
Resolution:
Follow-up:     <BUG-xxx or ENH-xxx reference, owner, due date>
```

---

## 6. Known issues carried into v1.1.0

| ID | Severity | Issue | Mitigation |
| --- | --- | --- | --- |
| ENH-001 | Medium | Migrations are a manual ECS task | Run `npm run migrate` as a one-off task before deploying schema changes |
| ENH-002 | Medium | No WAF/rate limiting | Monitor 5XX and request-rate alarms; add WAF in v1.1.0 |
| ENH-003 | Low | RDS certificate not verified by default | Set `NODE_EXTRA_CA_CERTS` + `DATABASE_SSL_VERIFY=true` for regulated workloads |
| ENH-004 | Low | Chatbot attachment is manual | Alarm emails still reach on-call; attach Chatbot when Slack channel is confirmed |
| ENH-005 | Low | No scheduled load test | Run `scripts/smoke-test.sh` against staging after each infrastructure change |

---

## 7. Access and ownership

| Area | Owner | Notes |
| --- | --- | --- |
| AWS account / IAM | Platform lead | Break-glass access requires MFA and is logged in CloudTrail |
| Terraform state bucket | Platform lead | Versioning on; deletion requires a ticket |
| GitHub repository and environments | Repo admin | `production` environment requires reviewer approval |
| Secrets Manager | Platform lead | Read access limited to the ECS execution role and break-glass role |
| Monitoring and alerting | On-call rota | SNS topic `sa-enterprise-prod-alerts` |

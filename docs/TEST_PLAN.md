# Test Plan & Results

**Project:** Cloud Infrastructure & CI/CD Pipeline (Project #4)
**Role:** QA Tester
**Version tested:** 1.0.0
**Date:** 2026-11-02

---

## 1. Scope

| In scope | Out of scope |
| --- | --- |
| Configuration validation, HTTP contract, readiness/drain behaviour | Penetration testing of the application domain logic |
| Graceful shutdown under SIGTERM | Multi-region failover |
| Image build, non-root execution, vulnerability scan | Load testing beyond the 500 rps deployment scenario |
| Terraform formatting, validation, idempotency | AWS account-level quota behaviour |
| ECS rolling deployment, circuit breaker, rollback | Chatbot/Slack integration (console step, manual check) |
| Secret injection and network isolation | Application features not present in the reference API |

---

## 2. Environments

| Environment | Purpose | Notes |
| --- | --- | --- |
| Local (Windows 11, Node 24.19.0) | Unit/integration suite, lint | No external services required |
| GitHub Actions runner (ubuntu-latest) | CI gates, image build/scan, container boot | Postgres 16 + Redis 7 service containers |
| AWS `af-south-1` staging/prod | Infrastructure and deployment behaviour | Same Terraform, separate `environment` value |

---

## 3. Test suites

### TS-01 Configuration validation (automated)

- Missing `DATABASE_URL` / `REDIS_URL` exits with code 78 (EX_CONFIG) and logs both keys.
- Malformed URLs (`mysql://`, `http://`) are rejected.
- Non-numeric or zero `PORT` is rejected.
- Defaults apply for optional values; boolean/numeric flags parse correctly.
- **Coverage:** `test/config.test.js`, `test/startup.test.js`

### TS-02 HTTP contract (automated)

- `/health` returns 200 without touching dependencies.
- `/ready` returns 200 when Postgres and Redis answer; 503 when either fails; 503 while draining.
- Readiness check times out (503) instead of hanging when a dependency does not respond.
- `GET /api/v1/items` clamps `limit`; `POST` validates name/description; `:id` rejects non-integers.
- Unknown routes return JSON 404; unexpected errors return generic 500 with no internal detail.
- `x-request-id` is echoed for log correlation.
- `/metrics` exposes Prometheus text including `http_requests_total` and `app_ready`.
- **Coverage:** `test/app.test.js`

### TS-03 Persistence and caching (automated, stubbed)

- Store pings, creates the schema idempotently, maps snake_case rows to camelCase.
- Missing row returns `null`; insert returns the persisted row.
- Cache-aside helper computes on miss, serves on hit, always writes a TTL.
- **Coverage:** `test/postgres.test.js`, `test/cache.test.js`

### TS-04 Container behaviour (CI)

- Image builds from `Dockerfile` target `runtime`.
- Trivy image scan reports no unfixed HIGH/CRITICAL findings.
- Container boots against real Postgres + Redis, applies the schema and answers `/health` and
  `/ready` with 200.
- `docker stop` (SIGTERM) exits with code 0 within the grace period.
- **Coverage:** `ci.yml` → `container` job

### TS-05 Infrastructure as code (CI + manual)

- `terraform fmt -check -recursive` passes.
- `terraform validate` passes after `init -backend=false`.
- `terraform plan` on the first apply creates the expected resource set.
- A second `plan` immediately after apply reports **no changes** (idempotency).
- `terraform plan` in a PR shows the diff for reviewer approval.
- **Coverage:** `ci.yml` → `security` job, `terraform.yml`

### TS-06 Zero-downtime deployment (E2E, staging)

1. Sustain load against the ALB (`artillery`/`hey`, 500 rps, 10 minutes).
2. Trigger `deploy.yml` with a colour/semantic change to `/health` payload.
3. Observe ECS service events: new tasks start, register, pass `/health`, old tasks drain.
4. **Pass criteria:** 0 connection resets, 0% 5XX attributable to the swap, p95 latency within 20%
   of baseline.

### TS-07 Rollback (E2E, staging)

1. Deploy a revision that fails its smoke test (e.g. `PORT` mismatch so `/ready` never returns 200).
2. Confirm `wait-for-service-stability` fails.
3. Confirm the rollback step restores the previous task definition.
4. Confirm the ALB serves the previous version and `/health` + `/ready` are 200.
5. Repeat manually via **Actions → Rollback**.
- **Pass criteria:** service healthy within 10 minutes of failure detection.

### TS-08 Secrets and isolation (security, staging)

| Check | Expected |
| --- | --- |
| `psql` from the public internet to the RDS endpoint | Connection times out |
| `redis-cli` from the public internet to the cache endpoint | Connection times out |
| Task definition in the ECS console | `secrets` entries reference Secrets Manager ARNs, no plaintext |
| `docker history` / image layers | No `.env`, no credentials |
| CloudWatch log group content | No credentials; `DATABASE_URL` never logged |
| Task without `secretsmanager:GetSecretValue` | Container fails to start (negative test) |
| GitHub repository secrets | Only optional non-AWS values; no AWS keys required |

### TS-09 Alerting (staging)

- Force 5XX responses until the ratio exceeds 5% for 5 minutes → alarm transitions to ALARM and SNS
  delivers to the subscribed endpoint.
- Kill a task's health endpoint → `UnHealthyHostCount` alarm fires.
- Load the API until CPU exceeds 85% → CPU alarm fires and autoscaling adds a task.

---

## 4. Results

| Suite | Result | Evidence |
| --- | --- | --- |
| TS-01 Configuration | **Pass** | 8 tests |
| TS-02 HTTP contract | **Pass** | 17 tests |
| TS-03 Persistence/cache | **Pass** | 8 tests |
| TS-04 Container | **Pass (CI)** | `ci.yml` container job |
| TS-05 IaC | **Pass** | `terraform fmt -check` + `terraform validate` clean |
| TS-06 Zero-downtime | **Pass (staging)** | 0 resets under 500 rps during rollout |
| TS-07 Rollback | **Pass (staging)** | automatic and manual paths verified |
| TS-08 Secrets/isolation | **Pass** | public connection attempts time out; no secrets in logs |
| TS-09 Alerting | **Pass (partial)** | 5XX and unhealthy-target alarms verified; Chatbot delivery manual |

**Unit suite:** 33 tests, 8 suites, 0 failures, ~3.3 s on Node 24.19.0 (Windows 11).
**Lint:** ESLint 10 flat config, 0 findings.

> **Evidence boundary:** TS-01 to TS-03 were executed against this repository. TS-04 to TS-09 were
> executed in the reference staging environment during the SDLC exercise; they are re-run on the
> first deployment of this repository (see `RUNBOOK.md` §7) and must be signed off in
> `MAINTENANCE_LOG.md` before the release is declared production-ready.

---

## 5. Exit criteria

- [x] All automated tests pass on Node 22 and 24
- [x] Lint clean, no unhandled promise rejections in test output
- [x] No unfixed HIGH/CRITICAL image or dependency findings
- [x] Terraform formatted and valid
- [x] Rollback verified both automatically and manually
- [x] No credential material in repository, image or logs
- [x] Alarms verified end to end for the two highest-severity signals

---

## 6. Residual risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| No WAF / rate limiting in front of the ALB | Abuse and credential stuffing reach the app | v1.1.0: AWS WAF managed rules |
| `DATABASE_SSL_VERIFY=false` by default | Traffic is encrypted but the RDS certificate is not verified | Set `NODE_EXTRA_CA_CERTS` + `DATABASE_SSL_VERIFY=true` |
| Slack/Teams notification is a manual console step | Alert may stop at email if nobody attaches Chatbot | Documented in runbook; ticket raised |
| Single region | Regional outage is a full outage | Snapshots + Terraform rebuild path documented |
| Migrations run as a separate task, not yet automated in the pipeline | Schema drift if skipped | Runbook step; v1.1.0 pre-deploy migration task |
| NAT gateway cost | Budget overrun in a demo account | Documented teardown profile |

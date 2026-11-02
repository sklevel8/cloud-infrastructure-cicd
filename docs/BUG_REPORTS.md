# Bug Reports

**Project:** Cloud Infrastructure & CI/CD Pipeline (Project #4)
**Role:** QA Tester
**Period:** v1.0.0 development and verification

Severity scale: **Critical** (data loss / outage), **High** (blocks release), **Medium** (degrades
operations), **Low** (cosmetic / developer experience).

---

## BUG-001 — ECS tasks crash because the execution role cannot read secrets

| Field | Value |
| --- | --- |
| Severity | High (blocks deployment) |
| Component | `terraform/iam.tf`, ECS task definition |
| Status | Resolved & verified |

**Observed:** New tasks exited with code 1 before the ALB could mark them healthy. CloudWatch showed
the container failing during startup; the agent logged `ResourceNotFoundException: Secrets Manager
can't find the specified secret` when resolving `DATABASE_URL`.

**Root cause:** The ECS task execution role carried only the AWS-managed
`AmazonECSTaskExecutionRolePolicy`, which permits pulling images and writing logs but **not**
`secretsmanager:GetSecretValue`. ECS resolves `secrets` before the application starts, so the
container never reached application code.

**Fix:** Added an inline policy scoped to the two secret ARNs:

```hcl
statement {
  sid       = "ReadRuntimeSecrets"
  actions   = ["secretsmanager:GetSecretValue"]
  resources = [aws_secretsmanager_secret.database_url.arn, aws_secretsmanager_secret.redis_url.arn]
}
```

plus a `kms:Decrypt` statement conditioned on `kms:ViaService = secretsmanager.<region>.amazonaws.com`.

**Verification:** Task reaches `RUNNING`, `/ready` returns 200, no secret value appears in task
definition JSON or logs.

---

## BUG-002 — Deployment hangs because the health check targets `/`

| Field | Value |
| --- | --- |
| Severity | Medium (stalls releases) |
| Component | `terraform/alb.tf` target group |
| Status | Resolved & verified |

**Observed:** `wait-for-service-stability` never completed. ECS events showed tasks starting and
being replaced repeatedly; the target group reported every target unhealthy.

**Root cause:** The target group used the ALB default health check path `/`, while the API serves
`/health`. Requests to `/` returned 200 on the reference build but the check was coupled to
application routing — any 404 at `/` marks a healthy task unhealthy, and here the proxy returned 404
for the bare path.

**Fix:** Explicit health check on the dependency-free liveness route, with tighter timings:

```hcl
health_check {
  path                = var.health_check_path   # "/health"
  matcher             = "200"
  interval            = 15
  timeout             = 5
  healthy_threshold   = 2
  unhealthy_threshold = 3
}
```

**Verification:** Deployment completes in ~90s; `/health` stays 200 during a simulated RDS failover
while `/ready` correctly reports 503.

---

## BUG-003 — `npm test` fails on Windows: `node --test test/` cannot resolve a directory

| Field | Value |
| --- | --- |
| Severity | Medium (developer experience, CI parity) |
| Component | `package.json` |
| Status | Resolved & verified |

**Observed:** `node --test test/` exited with `MODULE_NOT_FOUND: Cannot find module ...\test` on
Node 24.19.0 / Windows 11, while passing on Linux runners.

**Root cause:** The test runner interpreted the directory argument as a module specifier rather than
a discovery root in that invocation form.

**Fix:** Use an explicit glob so behaviour is identical on every platform:

```json
"test": "node --test \"test/**/*.test.js\""
```

**Verification:** `npm test` → 33/33 passing on Windows and on ubuntu-latest.

---

## BUG-004 — `app_ready` gauge never returned to 1 after a transient dependency failure

| Field | Value |
| --- | --- |
| Severity | Medium (false alerting) |
| Component | `src/app.js` `/ready` handler |
| Status | Resolved & verified |

**Observed:** After a simulated Redis outage, `app_ready` stayed at `0` even once `/ready` returned
200 again. Any dashboard or alarm built on the gauge would page indefinitely.

**Root cause:** The success branch returned early without resetting the gauge; only the failure
branches wrote to it.

**Fix:** Set `metrics.ready.set(1)` on the healthy path and `set(0)` on the degraded path, alongside
the existing drain behaviour.

**Verification:** `test/app.test.js` asserts `app_ready{...} 0` after drain; the readiness test
covers recovery in staging.

---

## BUG-005 — Security group rule written in the wrong direction

| Field | Value |
| --- | --- |
| Severity | High (would have silently blocked the data tier) |
| Component | `terraform/security.tf` |
| Status | Resolved (caught in design review before apply) |

**Observed:** During review of the first draft, two rules intended to let tasks reach Postgres and
Redis were declared as **egress** rules on the *data* security group with the app group as the
referenced peer. That authorises the database to initiate connections to the app — the opposite of
the requirement — while leaving task egress unstated.

**Root cause:** `aws_vpc_security_group_egress_rule` was used with `security_group_id` pointing at
the data group.

**Fix:** Egress on the **app** group referencing the data group, plus matching ingress on the data
group:

```hcl
resource "aws_vpc_security_group_egress_rule" "app_to_db" {
  security_group_id            = aws_security_group.app.id
  referenced_security_group_id = aws_security_group.data.id
  from_port = 5432
  to_port   = 5432
  ip_protocol = "tcp"
}
```

**Verification:** `/ready` 200 in the deployed stack; a task in the public tier cannot reach 5432.

---

## BUG-006 — Container crash-looped when Redis was briefly unavailable at boot

| Field | Value |
| --- | --- |
| Severity | Medium (availability during failover) |
| Component | `src/cache.js`, `src/server.js` |
| Status | Resolved & verified |

**Observed:** A single `client.connect()` call meant that any ElastiCache failover during task
startup produced an immediate process exit, and ECS replaced the task — repeatedly.

**Fix:** Bounded connect retries (5 attempts, 1s apart) before failing, after which node-redis'
reconnect strategy takes over. Log entries record each attempt without printing the URL.

**Verification:** `test/cache.test.js` covers cache-aside semantics; staging failover test shows the
task recovers instead of restarting.

---

## BUG-007 — CI container smoke test could never pass without dependencies

| Field | Value |
| --- | --- |
| Severity | Medium (false red pipeline) |
| Component | `.github/workflows/ci.yml` |
| Status | Resolved & verified |

**Observed:** The first version ran `docker run` with dummy `DATABASE_URL`/`REDIS_URL` values and then
polled `/health`. The app exits during boot when it cannot connect, so the gate failed on every run
and taught the team to ignore red builds.

**Fix:** Added Postgres 16 and Redis 7 GitHub service containers, ran the image with `--network host`
so it uses the real dependencies, and asserted both `/health` and `/ready`. A follow-up step stops the
container with SIGTERM and asserts exit code 0, which also tests the graceful-shutdown path.

**Verification:** Green run on the current `ci.yml`; shutdown step exits within the grace period.

---

## BUG-008 — Undefined Terraform variables referenced by the IAM policy

| Field | Value |
| --- | --- |
| Severity | High (apply would fail) |
| Component | `terraform/iam.tf`, `terraform/variables.tf` |
| Status | Resolved & verified |

**Observed:** `terraform validate` reported `Reference to undeclared input variable` for
`terraform_state_bucket` and `terraform_state_lock_table` after state-access statements were added to
the GitHub deploy role.

**Fix:** Declared both variables (default `""`), and wrapped the statements in `dynamic` blocks so no
policy is generated when they are unset.

**Verification:** `terraform fmt -check` and `terraform validate` pass; plan with empty values
produces the expected policy document.

---

## Open items (tracked for v1.1.0)

| ID | Severity | Description | Owner |
| --- | --- | --- | --- |
| ENH-001 | Medium | Automate schema migration as a pre-deploy ECS task instead of a manual step | Platform |
| ENH-002 | Medium | Attach AWS WAF managed rule group to the ALB | Security |
| ENH-003 | Low | Ship the RDS CA bundle and enable `DATABASE_SSL_VERIFY=true` by default | Platform |
| ENH-004 | Low | Replace SNS-email with Chatbot Slack/Teams delivery in infrastructure code | Platform |
| ENH-005 | Low | Add `hey`/Artillery load test as a scheduled staging job | QA |

# HR MAX — Deployment & Rollback Guide

How the AWS build ships, how to roll it back, and the one-time CI setup.

## 1. What deploys where

| Piece | Tool | Target | Notes |
|---|---|---|---|
| Backend API + schedulers + Cognito + DynamoDB + buckets + CloudFront | **SAM → CloudFormation** (stack `hrmax-api`, region `ap-southeast-2`) | Lambda `ApiFn` / `PreTokenFn` / `PreSignUpFn` / `SchedulerFn`, HTTP API, EventBridge rules, S3, CloudFront | `backend/aws/template.yaml` is the single source of truth |
| Frontend SPA | `scripts/deploy-hosting.mjs` | S3 `hrmax-web-549243453699` + CloudFront invalidation (`E6FZDS9H02L9A`) | syncs `frontend/dist/` |
| CI/CD | `.github/workflows/deploy.yml` | both, via a scoped IAM deploy user (see §4 — OIDC is blocked by an Organizations SCP) | push to `main` or manual `workflow_dispatch` |

## 2. Manual deploy (from repo root)

Prerequisites: Node 20+, AWS CLI credentials for account `549243453699`
(`aws configure` / `aws sso login`), AWS SAM CLI.

```powershell
# 1. Frontend build (needs frontend/.env with the VITE_* values)
npm run build

# 2. Backend build + tests
npm test                 # tsc + 17 unit tests

# 3. Backend deploy  (PowerShell 5 needs cmd /c for &&)
cmd /c "sam build -t backend/aws/template.yaml && sam deploy --no-confirm-changeset --no-fail-on-empty-changeset"

# 4. Hosting deploy
node scripts/deploy-hosting.mjs
```

Verify: `GET https://u2y0p4665a.execute-api.ap-southeast-2.amazonaws.com/api/health`
→ `{"ok":true,...}`, then open the CloudFront URL (`https://d3mt3qaxw5o28k.cloudfront.net`).

## 3. Rollback

Backend (code regression, stack still healthy):

```powershell
# Option A — redeploy the last good commit (preferred, data-safe)
git checkout <last-good-sha>
cmd /c "sam build -t backend/aws/template.yaml && sam deploy --no-confirm-changeset --no-fail-on-empty-changeset"
git checkout main

# Option B — CloudFormation console → stack hrmax-api → Events → the failed
# update already auto-rolled back (Disable rollback = False is the default).
# For a *successful but bad* deploy, Stack actions → "Create change set for
# current stack" is NOT a time machine — re-deploy the old code instead.
```

Frontend (bad SPA build):

```powershell
git checkout <last-good-sha>
npm run build
node scripts/deploy-hosting.mjs
git checkout main
```

Data: DynamoDB table `HRMAX` has **no** destructive deploy path (stack updates
never replace the table — the changeset above replaces nothing). Point-in-time
recovery/backups are the data-side safety net; keep the Firebase source data
until you sign off (it has not been deleted).

## 4. CI/CD (GitHub Actions) — one-time setup

### 4a. GitHub repo secrets

| Secret | Value |
|---|---|
| `AWS_ACCESS_KEY_ID` | access key of the deploy user `hrmax-gha-deploy` |
| `AWS_SECRET_ACCESS_KEY` | its secret key (both = `~/.hrmax/gha-key.json` on the dev machine, keep a backup) |
| `VITE_AWS_REGION` | `ap-southeast-2` |
| `VITE_COGNITO_USER_POOL_ID` | `ap-southeast-2_DUe0sfFOx` |
| `VITE_COGNITO_CLIENT_ID` | `3ginli5f52pf07c46ltgrq0rvc` |
| `VITE_API_URL` | `https://u2y0p4665a.execute-api.ap-southeast-2.amazonaws.com` (no trailing slash) |
| `VITE_FILES_BUCKET_URL` | `https://d3mt3qaxw5o28k.cloudfront.net` |

Repo → Settings → Secrets and variables → Actions → New repository secret.
(The `VITE_*` values are not sensitive per se — they are already public in the
SPA bundle — but keeping them as secrets lets CI build the same bytes as local.)

### 4b. Deploy identity (AWS side)

The workflow signs in as the IAM user **`hrmax-gha-deploy`** with a scoped
policy: AWS managed **`PowerUserAccess`** (every service except IAM) plus an
inline policy limited to this account's `role/*` and `policy/*` — enough for
SAM to create/replace the Lambda execution roles and nothing else.

Rotate: `aws iam create-access-key --user-name hrmax-gha-deploy`, set the two
secrets, then `aws iam delete-access-key --user-name hrmax-gha-deploy --access-key-id <old>`.
Disable/delete: `aws iam delete-user --user-name hrmax-gha-deploy` (detach the
inline policy first: `aws iam delete-user-policy --user-name hrmax-gha-deploy --policy-name hrmax-deploy-iam`).

> **Why not OIDC?** This workflow was OIDC (`role-to-assume`) first. GitHub's
> tokens were rejected with `InvalidIdentityToken` for *every* audience, which
> means the account's `token.actions.githubusercontent.com` provider fails
> AWS's certificate (thumbprint) validation — and Organizations SCP
> `p-ycumau78` explicitly denies `iam:GetOpenIDConnectProvider`,
> `iam:CreateOpenIDConnectProvider`,
> `iam:UpdateOpenIDConnectProviderThumbprint` and
> `iam:DeleteOpenIDConnectProvider` for account `549243453699`, so the provider
> cannot be inspected or repaired from here. **Fix path:** the org admin (owner
> of account `427223155383`) recreates the provider with a current thumbprint
> and client ID `sts.amazonaws.com` (or relaxes those SCP denies); then switch
> `.github/workflows/deploy.yml` back to `role-to-assume` and set
> `AWS_DEPLOY_ROLE_ARN` again. Deleting the throwaway role used during this
> attempt keeps the account clean.

## 5. Local development

```powershell
npm run dev          # vite dev server (frontend/.env → API URL)
npm run build:backend
npm test             # unit tests, no AWS calls
sam local start-api  # local API (needs local env vars + AWS creds for DynamoDB)
```

## 6. Post-deploy verification checklist

1. `GET /api/health` → 200.
2. Log in as master-admin → dashboard lists populate (employees/departments/
   salary slips/users/leave requests).
3. Admin-alerts + roles tabs load without 404s (polling requests stop retry-storming).
4. Leave request review flow end-to-end (review → status change → notification).
5. CloudWatch `/aws/lambda/hrmax-api` — no `ERROR` lines.

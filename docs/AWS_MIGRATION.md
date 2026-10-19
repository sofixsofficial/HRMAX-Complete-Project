# HR MAX — Firebase → AWS Migration Guide

This repository is the **AWS edition** of HR MAX. The Firebase backend (Auth,
Firestore, Cloud Functions, FCM, SMTP) has been fully replaced by AWS services,
while the web and mobile UIs are unchanged. The original Firebase project is
preserved untouched in a separate repository/copy.

---

## 1. Architecture

| Concern | Before (Firebase) | Now (AWS) |
|---|---|---|
| Auth | Firebase Auth (email/password) | **Amazon Cognito** user pool (`hrmax-users`), custom attributes `role`/`companyId`; a `PreTokenGeneration` Lambda injects them as JWT claims |
| Data | Firestore (per-collection rules) | **DynamoDB** single-table design (`PK=COMPANY#<id>`, `SK=ENTITY#<id>`, GSI1 per-user, GSI2 by role, GSI3 global listing) |
| API | ~104 Cloud Functions (callables + triggers) | **API Gateway (HTTP API)** fronting **Lambda** handlers (Node 22, TypeScript, ESM) in `backend/aws/src` |
| Files | Firebase Storage | **S3** (`FilesBucket`) with presigned uploads via `/api/storage/presign` |
| Email | SMTP (nodemailer) | **SES** — templates live in `backend/aws/src/lib/email.ts`; sender must be SES-verified |
| Push | FCM | Device push tokens are stored on user docs (`pushToken`); delivery wiring is stubbed in `lib/notify.ts` for your push provider of choice |
| Scheduled jobs | `functions.pubsub.schedule` | **EventBridge Scheduler**: attendance sweep `0 18 * * ? *`, day cutoff `0 16 * * 1-5 *`, payroll reminder `30 2 1 * ? *` (all **UTC**) |
| Hosting | Firebase Hosting | **S3 + CloudFront** (`WebBucket` → `WebDistribution`) |

### Client compatibility shims

The frontend and mobile apps were **not rewritten** — they keep importing
`firebase/auth`, `firebase/firestore`, `firebase/functions`, `firebase/storage`.
Those imports are mapped to local shims:

- Web: `vite.config.ts` `resolve.alias` + `tsconfig.app.json` `paths` → `frontend/src/aws/*`
- Mobile: `metro.config.js` resolver → `mobile-app/src/aws/*`

The shims translate the Firebase API surface into REST calls against the AWS
API (with the Cognito JWT attached). `onSnapshot` is emulated with 20-second
polling. Firebase itself is no longer a dependency of either app.

### Legacy callable dispatcher (`POST /fn/:name`)

The original codebase called ~69 distinct `httpsCallable` names. Callables
that map cleanly to a REST route (auth, attendance mark, payroll calc, email
send, broadcast) go straight there; **everything else is dispatched by name**
via `POST /fn/{name}` — a single backend route (`backend/aws/src/handlers/legacy.ts`)
that looks up the callable in a registry and executes the ported business
logic. This guarantees no callable name ever points at a route that does not
exist, and lets the shims keep their `ROUTE_MAP` tiny.

---

## 2. Prerequisites

- **AWS CLI v2** (`aws --version`) and **AWS SAM CLI** (`sam --version`)
- AWS credentials: `aws login --profile default` (browser sign-in; credentials
  valid 12h, renewable for 90 days) — region `ap-southeast-2` (your project's
  selected Region; all regional resources go here)
- Node.js 22+
- For email: an SES-verified sender address in the **same region** as the stack

---

## 3. Deploy the backend (first time)

```bash
cd backend/aws
npm install
npm run typecheck      # tsc --noEmit
npm run build          # tsc → dist/
sam build
sam deploy --guided
```

`--guided` prompts for:

| Prompt | Suggested value |
|---|---|
| Stack Name | `hrmax-api` |
| AWS Region | `ap-southeast-2` (your project's selected Region) |
| Parameter AppDomain | leave blank (uses default CloudFront domain) |
| Parameter EmailFrom | your SES-verified address (default `no-reply@hrmax.in`) |
| Save samconfig.toml | yes |
| Allow SAM IAM role creation | yes |

Subsequent deploys: `sam build && sam deploy` (or from the repo root:
`npm run deploy:backend`).

### Collect stack outputs

```bash
aws cloudformation describe-stacks --stack-name hrmax-api \
  --query "Stacks[0].Outputs" --output table
```

You need: **ApiUrl**, **UserPoolId**, **UserPoolClientId**, **WebBucketName**,
**CloudFrontUrl**, **FilesBucketName**, **TableName**.

### Verify SES sender

In the same region: **SES → Verified identities** — verify `EmailFrom` (and
move out of the SES sandbox before production, or outgoing mail to
unverified recipients is rejected).

---

## 4. Configure + deploy the web app

```bash
cd frontend
cp .env.example .env    # then fill in the values:
```

```env
VITE_AWS_REGION=ap-southeast-2
VITE_COGNITO_USER_POOL_ID=<UserPoolId>
VITE_COGNITO_CLIENT_ID=<UserPoolClientId>
VITE_API_URL=<ApiUrl>              # no trailing slash
VITE_FILES_BUCKET_URL=<CloudFrontUrl>
```

```bash
npm install
npm run build          # dist/
```

Deploy hosting (from the repo root):

```bash
npm run deploy:hosting # syncs dist/ to the web bucket + invalidates CloudFront
```

The app is then live at the **CloudFrontUrl**.

---

## 5. Configure the mobile app

`mobile-app/.env` (or `app.json` extra) — same values with `EXPO_PUBLIC_` prefix:

```env
EXPO_PUBLIC_AWS_REGION=ap-southeast-2
EXPO_PUBLIC_COGNITO_USER_POOL_ID=<UserPoolId>
EXPO_PUBLIC_COGNITO_CLIENT_ID=<UserPoolClientId>
EXPO_PUBLIC_API_URL=<ApiUrl>
EXPO_PUBLIC_FILES_BUCKET_URL=<CloudFrontUrl>
```

Run with `npm run mobile` from the repo root (Expo), or build with EAS as before.

---

## 6. First-run checklist

1. **Create the master admin** — the Cognito pool starts empty. Either:
   - sign up through the app's registration flow (if enabled), then promote the
     user's `role` to `master-admin` in DynamoDB (`USER#<uid>` under the
     company partition), or
   - create the user in the Cognito console and set `custom:role=master-admin`,
     `custom:companyId=<company-id>`; the users table row is created on first
     `/api/me` call via the PreTokenGeneration flow.
2. **Create a company** (`/api/companies`), then company admins and staff —
   invitation emails go out through SES (`/api/auth/invite`).
3. **Attendance / payroll schedules** are EventBridge rules in UTC — adjust the
   three cron expressions in `backend/aws/template.yaml` if your working day
   should cut over at a different local time (Nepal = UTC+5:45).

---

## 7. What stayed the same

- All UI/UX, routes, forms, dashboards — untouched.
- Business rules: 4-tier leave/missed-punch approval chains
  (reporting-manager → company-admin → executive → team-leader + master-admin
  gate), 15-min grace / 30-min overtime / 30-min early-checkout attendance
  thresholds, payroll divisor 26, December-only leave encashment,
  5-working-day payslip correction window, email 60-second dedup,
  stakeholder fan-out notifications.
- Data model: the single-table DynamoDB layout mirrors the Firestore document
  shapes 1:1 (see `docs/migration/inventory-collections.md`).

## 8. Reference inventories

Migration analysis documents produced from the original Firebase codebase:

- `docs/migration/inventory-collections.md` — every Firestore collection, its
  fields, and the queries that must be reproduced.
- `docs/migration/inventory-backend-functions.md` — all Cloud Functions and the
  business rules they implemented.
- `docs/migration/inventory-auth-storage.md` — auth/permission model and
  security rules → now enforced API-side (`lib/auth.ts`) and in Cognito claims.

## 9. Repository layout (AWS edition)

```
backend/aws/       SAM app: template.yaml + Lambda handlers (TypeScript)
frontend/          Web app (React + Vite) — shims in src/aws/
mobile-app/        Expo app — shims in src/aws/, metro.config.js resolver
scripts/           deploy-hosting.mjs (S3 sync + CloudFront invalidation)
docs/migration/    Firebase inventories (reference)
backend/functions/ Original Firebase functions (reference only — not deployed)
firestore.rules    Original Firestore rules (reference only)
```

The original Firebase project copy remains untouched and deployable
(`firebase deploy`) if you ever need to roll back — it is independent of this
repository's AWS configuration.

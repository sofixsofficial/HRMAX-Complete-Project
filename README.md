# HR MAX — Multi-Tenant HR Management Suite

A production-oriented HR Management System built by **Sofixs** as a multi-tenant SaaS. One platform serves many companies, each isolated by company, with role-based access from attendance to payroll.

> HR MAX is an actual shipped product — web + mobile + cloud backend — built to be used, not just demoed.

## What's included

### Applications
- **Web app** (`frontend/`) — React 19, TypeScript, Vite, Tailwind CSS 4, Zustand, react-hook-form + Zod validation.
- **Mobile app** (`mobile-app/`) — Expo SDK 54 / React Native 0.81, with camera (QR + selfie check-in), push notifications, geolocation, offline storage, and PDF print/share.
- **Backend** (`backend/aws/`) - AWS serverless (Cognito auth, DynamoDB, API Gateway + Lambda, S3/CloudFront hosting, SES email, EventBridge schedules).

### Core modules
- **Multi-tenant company isolation** — every record is scoped by `companyId`; API-side authorization blocks cross-company access.
- **Role & permission system** — six roles with per-role permissions: `master-admin`, `company-admin`, `team-leader`, `reporting-manager`, `executive`, `employee`.
- **Attendance** — QR check-in and selfie-verified check-in, attendance settings, and admin approval flows.
- **Leave management** — multi-tier approval chain (reporting manager → company admin → team leader → executive).
- **Payroll** — salary structure, scheduled payroll runs, and PDF salary slips.
- **Tasks, announcements, documents, holidays, transfers, birthdays** — core HR operations.
- **Notifications** — push (FCM) and email (SMTP) with role-aware fan-out (e.g., team-leader actions notify overseeing executives + master-admins).
- **Audit logging** — actions recorded with actor, entity, and timestamp.
- **Role dashboards** — dedicated dashboards for master-admin, company-admin, team-leader, reporting-manager, executive, and employee.

## Tech stack

| Layer | Technology |
|---|---|
| Web | React 19, TypeScript, Vite, Tailwind 4, Zustand |
| Mobile | Expo SDK 54, React Native 0.81 |
| Auth | Amazon Cognito (JWT with role/company claims) |
| API | API Gateway (HTTP API) + Lambda (Node 22, TypeScript) |
| Data | DynamoDB (single-table design) |
| Files / Hosting | S3 + CloudFront |
| Email | Amazon SES |
| Schedules | EventBridge Scheduler |

## Getting started

```bash
# Install (root workspaces: frontend + backend)
npm install

# Web dev server
npm run dev

# Typecheck + lint
npm run lint

# Mobile (Expo)
npm run mobile
```

### AWS setup

Full deploy guide: **[`docs/AWS_MIGRATION.md`](docs/AWS_MIGRATION.md)**.

Quick version:

```bash
# 1. Backend (Cognito + DynamoDB + API + S3/CloudFront + SES + schedules)
cd backend/aws && npm install
sam build && sam deploy --guided     # stack name: hrmax-api

# 2. Web app env (frontend/.env — values from stack outputs)
#    VITE_AWS_REGION, VITE_COGNITO_USER_POOL_ID, VITE_COGNITO_CLIENT_ID,
#    VITE_API_URL, VITE_FILES_BUCKET_URL

# 3. Build + deploy hosting (S3 sync + CloudFront invalidation)
npm run deploy:hosting
```

The web and mobile apps keep their Firebase-style imports (`firebase/auth`,
`firebase/firestore`, …) — these are aliased to local AWS shims
(`frontend/src/aws/`, `mobile-app/src/aws/`) via Vite/Metro config, so no app
code changes were needed.

## Repository layout

```
frontend/        Web application (React + Vite) — AWS shims in src/aws/
mobile-app/      Expo / React Native application — AWS shims in src/aws/
backend/aws/     AWS SAM backend (Lambda + API Gateway + template.yaml)
scripts/         deploy-hosting.mjs (S3 sync + CloudFront invalidation)
tools/migrate/   Firebase→AWS data migration tooling (export/import/verify)
docs/            AWS migration guide + Firebase inventories
```

## Documentation

- `docs/AWS_MIGRATION.md` — full AWS deploy guide (this repo's backend).
- `docs/migration/MIGRATION_VERIFICATION.md` — data migration verification report.
- `docs/migration/` — Firebase inventories produced during the migration.
- `ROLE_SYSTEM_EXPLAINED.md` — how roles and permissions work in practice.
- `HRMS_AUTH_README.md` — authentication & authorization architecture.
- `BUILD_OPTIMIZATION.md` — web bundle performance notes.
- `SANITY_TESTING.md` — end-to-end sanity checks.

## Status

Actively developed. See `git log` for the current feature history.

---

Built by [Sofixs](https://www.sofixs.com) — Kathmandu & Janakpur, Nepal.

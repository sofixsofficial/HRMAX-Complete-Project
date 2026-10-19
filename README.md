# HR MAX — Multi-Tenant HR Management Suite

A production-oriented HR Management System built by **Sofixs** as a multi-tenant SaaS. One platform serves many companies, each isolated by company, with role-based access from attendance to payroll.

> HR MAX is an actual shipped product — web + mobile + cloud backend — built to be used, not just demoed.

## What's included

### Applications
- **Web app** (`frontend/`) — React 19, TypeScript, Vite, Tailwind CSS 4, Zustand, react-hook-form + Zod validation.
- **Mobile app** (`mobile-app/`) — Expo SDK 54 / React Native 0.81, with camera (QR + selfie check-in), push notifications, geolocation, offline storage, and PDF print/share.
- **Backend** (`backend/`) — Firebase Cloud Functions (Firebase Auth, Firestore, scheduled jobs, SMTP email, FCM push).

### Core modules
- **Multi-tenant company isolation** — every document is scoped by `companyId`; Firestore rules block cross-company access.
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
| Backend | Firebase (Auth, Firestore, Cloud Functions) |
| Notifications | FCM push + SMTP email |
| Docs | jsPDF / jsPDF-autotable (salary slips) |

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

### Firebase setup

Requires a Firebase project with Email/Password auth, Firestore, and Cloud Functions.

Web app environment variables (`frontend/.env`):

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

Deploy:

```bash
npm run build              # web build
npm run deploy:all         # hosting + functions + rules
```

## Repository layout

```
frontend/        Web application (React + Vite)
mobile-app/      Expo / React Native application
backend/         Firebase Cloud Functions
.firebaserc      Firebase project config
firestore.rules  Security rules (multi-tenant isolation)
docs             Role system & architecture references
```

## Documentation

- `ROLE_SYSTEM_EXPLAINED.md` — how roles and permissions work in practice.
- `HRMS_AUTH_README.md` — authentication & authorization architecture.
- `BUILD_OPTIMIZATION.md` — web bundle performance notes.
- `SANITY_TESTING.md` — end-to-end sanity checks.

## Status

Actively developed. See `git log` for the current feature history.

---

Built by [Sofixs](https://www.sofixs.com) — Kathmandu & Janakpur, Nepal.

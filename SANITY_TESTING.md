# HR MAX - Sanity Testing Guide

## What is Sanity Testing?
Quick, basic tests to verify the application works at a high level after changes. Focus on critical paths only.

---

## Pre-Testing Setup

### 1. Environment Check
```bash
# Verify Node.js version (should be 18+)
node --version

# Install dependencies
npm install

# Start dev server
npm run dev
```

### 2. Firebase Setup Check
- [ ] Firebase project is created
- [ ] Email/Password authentication is enabled
- [ ] Firestore database is created
- [ ] `.env` file has correct Firebase credentials
- [ ] Firestore security rules are deployed

---

## Quick Sanity Test Checklist (5-10 minutes)

### 🔐 Authentication Flow
| Test | Steps | Expected Result | Status |
|------|-------|-----------------|--------|
| Registration | Go to `/register` → Fill company form → Submit | Company created, redirected to login | ⬜ |
| Login | Go to `/login` → Enter credentials → Submit | Logged in, redirected to dashboard | ⬜ |
| Logout | Click logout button | Redirected to login page | ⬜ |
| Forgot Password | `/forgot-password` → Enter email → Submit | Success message shown | ⬜ |

### 📊 Dashboard
| Test | Steps | Expected Result | Status |
|------|-------|-----------------|--------|
| Dashboard Load | Login as any role | Dashboard loads with stats | ⬜ |
| Sidebar Navigation | Click each menu item | Pages load without errors | ⬜ |
| Role-Based View | Login as Executive vs Admin | Different views shown | ⬜ |

### 👥 Core Features (Pick 2-3)
| Feature | Quick Test | Expected Result | Status |
|---------|-----------|-----------------|--------|
| Employees | View list → Add employee | Employee appears in list | ⬜ |
| Attendance | View attendance → Check in | Record created | ⬜ |
| Tasks | View tasks → Create task | Task appears in list | ⬜ |

---

## Role-Based Sanity Tests

### 1. Master Admin
**Permissions:** Full system access
```
Tests:
- Can view all companies
- Can view all employees across companies
- Can access audit logs
- Can manage roles
```

### 2. Company Admin
**Permissions:** Full company access
```
Tests:
- Can view own company only
- Can manage all employees in company
- Can access all company features
- Cannot see other companies
```

### 3. Team Leader
**Permissions:** Department-level access
```
Tests:
- Can view department employees
- Can approve attendance for team
- Can assign tasks to team members
- Cannot edit company settings
```

### 4. Executive
**Permissions:** Self-access only
```
Tests:
- Can view own profile only
- Can view own tasks
- Can view own attendance
- Cannot access admin features
```

---

## Automated Sanity Tests

### Run Build Test
```bash
# Build should complete without errors
npm run build
```

### Run Linter
```bash
# Check for code issues
npm run lint
```

### Check Console Errors
1. Open browser DevTools (F12)
2. Go to Console tab
3. Clear existing logs
4. Navigate through app
5. **Pass:** No red errors (except Firebase config warnings in dev)

---

## API/Firestore Sanity Tests

### Check Firestore Connection
```javascript
// In browser console
db.collection('users').get().then(snap => console.log('Connected:', snap.size))
```

### Verify Auth State
```javascript
// In browser console
firebase.auth().currentUser
// Should return user object or null
```

---

## Mobile Responsive Check

Quick checks on mobile view (Chrome DevTools):
- [ ] Login page displays correctly
- [ ] Sidebar is accessible (hamburger menu)
- [ ] Tables are scrollable
- [ ] Buttons are clickable

---

## Common Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| "No role detected" | Auth state not syncing | Refresh page, check Firebase Auth |
| Blank page after login | Redirect loop | Check browser console for errors |
| "Permission denied" | Firestore rules | Deploy updated firestore.rules |
| Slow loading | No indexes | Create composite indexes in Firebase Console |
| CORS errors | Missing config | Check Firebase Auth domain settings |

---

## Smoke Test Script (Quick)

Run this in terminal:

```bash
#!/bin/bash
echo "=== HR MAX Sanity Test ==="

echo "1. Checking build..."
npm run build || exit 1

echo "2. Checking for critical files..."
test -f src/types/user.ts && echo "✓ Types exist"
test -f src/services/authService.ts && echo "✓ Auth service exists"
test -f .env && echo "✓ Environment file exists"

echo "3. Checking git status..."
git status --short

echo "=== Quick Test Complete ==="
```

---

## When to Do Sanity Testing?

✅ **After:**
- Any code changes
- Dependency updates
- Firebase configuration changes
- New feature addition
- Before deploying to production

❌ **Not needed for:**
- README updates
- Comment changes
- Formatting-only changes

---

## Sign-off Checklist

Before considering sanity test complete:

- [ ] Build succeeds (`npm run build`)
- [ ] No console errors
- [ ] Login works
- [ ] Dashboard loads
- [ ] At least 2 core features work
- [ ] Logout works
- [ ] Responsive on mobile

---

## Next Steps After Sanity Test

1. ✅ **Pass:** Proceed with detailed testing or deployment
2. ❌ **Fail:** Fix critical issues, re-run sanity test
3. ⚠️ **Partial:** Document known issues, test fixed items

---

## One-Command Sanity Test

```bash
npm run build && echo "✓ Build OK" && npm run lint && echo "✓ Lint OK"
```

If this passes, your app is likely working! 🎉

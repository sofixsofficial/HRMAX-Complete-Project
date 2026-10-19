# HRMS Enterprise Authentication System

A scalable, enterprise-grade HR Management System authentication and authorization architecture using Firebase.

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENT SIDE                          │
├─────────────────────────────────────────────────────────────┤
│  React + TypeScript                                         │
│  ├── Auth Context (Global auth state)                       │
│  ├── Protected Routes (Role & Permission guards)            │
│  ├── Login / Register / Accept Invite pages                 │
│  └── Permission-based UI components                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     FIREBASE SERVICES                       │
├─────────────────────────────────────────────────────────────┤
│  Firebase Auth        │  Custom Claims (role, companyId)    │
│  Firebase Firestore   │  Multi-tenant data isolation        │
│  Cloud Functions      │  Secure backend operations          │
│  Security Rules       │  Data access control                │
└─────────────────────────────────────────────────────────────┘
```

## 📁 Project Structure

```
src/
├── firebase/
│   └── config.ts                 # Firebase initialization
│
├── types/
│   └── hrms.ts                   # All TypeScript types
│
├── contexts/
│   └── AuthContext.tsx           # Auth state management
│
├── services/
│   └── authService.ts            # Auth API calls
│
├── components/
│   └── ProtectedRoute.tsx        # Route guards
│
├── pages/
│   └── auth/
│       ├── Login.tsx             # Sign in page
│       ├── Register.tsx          # Company registration
│       └── AcceptInvite.tsx      # Accept invitation
│
functions/
├── src/
│   └── index.ts                  # Cloud Functions
├── package.json
└── tsconfig.json

firestore.rules                   # Security Rules
```

## 🚀 Getting Started

### 1. Firebase Setup

#### Create Firebase Project
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create a new project
3. Enable **Email/Password** authentication
4. Create a Firestore database
5. Install Firebase CLI: `npm install -g firebase-tools`
6. Login: `firebase login`
7. Initialize: `firebase init`

#### Environment Variables

Create `.env` file:

```env
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abcdef
VITE_FIREBASE_MEASUREMENT_ID=G-XXXXXXXXXX
```

### 2. Install Dependencies

```bash
# Frontend
npm install firebase

# Cloud Functions
cd functions
npm install
```

### 3. Deploy Cloud Functions

```bash
firebase deploy --only functions
```

### 4. Deploy Security Rules

```bash
firebase deploy --only firestore:rules
```

### 5. Run Development Server

```bash
npm run dev
```

## 🔐 User Roles & Hierarchy

```
super_admin
    └── Can manage all companies
    
company_admin
    └── Can manage their company
    └── Can invite HR managers
    
hr_manager
    └── Can manage employees
    └── Can invite employees/department managers
    
department_manager
    └── Can manage their department
    └── Can view team attendance/leave
    
employee
    └── Can view own profile
    └── Can request leave
    └── Can view own payroll
    
intern
    └── Limited access
    └── View-only for basic info
```

## 📋 Authentication Flows

### 1. Company Registration

```
User fills registration form
        ↓
Firebase Auth creates user
        ↓
Cloud Function creates:
  - Company document
  - User document
  - Custom claims (role: company_admin)
        ↓
Redirect to admin dashboard
```

### 2. Login

```
User enters credentials
        ↓
Firebase Auth validates
        ↓
Get ID token with custom claims
        ↓
Fetch user document from Firestore
        ↓
Redirect based on role:
  - company_admin → /admin/dashboard
  - hr_manager → /hr/dashboard
  - employee → /employee/dashboard
```

### 3. Invitation Flow

```
Admin invites user (email + role)
        ↓
Cloud Function creates invitation
        ↓
Email sent with invite link
        ↓
User clicks link (/accept-invite?token=xxx)
        ↓
User creates password
        ↓
Cloud Function:
  - Creates Firebase Auth user
  - Sets custom claims
  - Creates user document
  - Marks invitation accepted
        ↓
Redirect to dashboard
```

## 🛡️ Security Features

### Custom Claims
Every user has custom claims in their JWT token:
```json
{
  "role": "hr_manager",
  "companyId": "abc123",
  "permissions": {
    "employee_view": true,
    "employee_create": true,
    ...
  }
}
```

### Firestore Security Rules
- Users can only access data from their company
- Role-based read/write permissions
- All documents must have `companyId`
- Cross-company access is blocked

### Cloud Functions
All sensitive operations go through Cloud Functions:
- User invitations
- Role changes
- Company creation
- Audit logging

## 📊 Firestore Collections

```
companies/{companyId}
├── name: string
├── slug: string
├── subscriptionPlan: string
├── active: boolean
└── ...

users/{uid}
├── companyId: string
├── email: string
├── name: string
├── role: string
├── permissions: map
├── active: boolean
└── ...

departments/{departmentId}
├── companyId: string
├── name: string
├── managerId: string
└── ...

invitations/{inviteId}
├── companyId: string
├── email: string
├── role: string
├── token: string
├── status: string
└── ...

audit_logs/{logId}
├── companyId: string
├── userId: string
├── action: string
├── entity: string
├── timestamp: timestamp
└── ...
```

## 🔧 Usage Examples

### Protected Route
```tsx
import { ProtectedRoute, CompanyAdminRoute } from './components/ProtectedRoute';

// Basic protection
<Route path="/admin" element={
  <ProtectedRoute allowedRoles={['company_admin', 'super_admin']}>
    <AdminPage />
  </ProtectedRoute>
} />

// Pre-defined role guard
<Route path="/hr" element={
  <HRManagerRoute>
    <HRPage />
  </HRManagerRoute>
} />

// Permission-based
<Route path="/payroll" element={
  <ProtectedRoute requiredPermissions={['payroll_view']}>
    <PayrollPage />
  </ProtectedRoute>
} />
```

### Permission Guard in Components
```tsx
import { PermissionGuard } from './components/ProtectedRoute';

<PermissionGuard permissions={['employee_create']}>
  <button>Add Employee</button>
</PermissionGuard>
```

### Use Auth Hook
```tsx
import { useAuth } from './contexts/AuthContext';

function MyComponent() {
  const { user, hasPermission, isHRManager } = useAuth();
  
  if (hasPermission('employee_edit')) {
    // Show edit button
  }
}
```

### Invite User
```tsx
import { inviteUser } from './services/authService';

const handleInvite = async () => {
  const { inviteId, inviteLink } = await inviteUser(
    'newuser@company.com',
    'employee',
    'John Doe',
    'dept_123'
  );
  // Send inviteLink via email
};
```

## 📈 Best Practices

1. **Always validate permissions on the backend** - Never trust frontend-only checks
2. **Use Cloud Functions for sensitive operations** - Don't expose admin functions to client
3. **Log all important actions** - Use audit logs for compliance
4. **Keep security rules strict** - Default deny, explicit allow
5. **Use TypeScript** - Type safety prevents bugs
6. **Test with Firebase Emulators** - Local testing before deployment

## 🔍 Testing

```bash
# Start Firebase emulators
firebase emulators:start

# Run tests
npm test
```

## 📚 Additional Resources

- [Firebase Auth Docs](https://firebase.google.com/docs/auth)
- [Firestore Security Rules](https://firebase.google.com/docs/firestore/security/get-started)
- [Cloud Functions](https://firebase.google.com/docs/functions)
- [Custom Claims](https://firebase.google.com/docs/auth/admin/custom-claims)

## 📄 License

MIT License - Enterprise use allowed

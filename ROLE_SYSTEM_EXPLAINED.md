# HR MAX - Role & Access System Explained

## How It Works

### 1. Two Different Role Systems

**System A: Hardcoded Roles (Authentication)**
- Defined in: `src/types/user.ts` and `src/services/authService.ts`
- 4 roles: `master-admin`, `company-admin`, `team-leader`, `executive`
- Used for: Login, permissions, sidebar access

**System B: Custom Roles (Roles & Access Page)**
- Stored in: Firestore `roles` collection
- Used for: Organizing permissions, reporting
- **Not connected to actual user authentication**

### 2. How Users Get Their Role

When a user is **created/invited**, their role is set in the user document:
```javascript
// In Firestore users collection
{
  id: "user123",
  name: "John Doe",
  email: "john@company.com",
  role: "company-admin",  // <-- This determines access
  permissions: ["employee_view", "employee_create", ...]
}
```

### 3. How Permissions Work

**Step 1: User Logs In**
- Firebase Auth verifies email/password
- User document is fetched from Firestore
- Role and permissions are loaded into AuthContext

**Step 2: Sidebar Checks Permissions**
```typescript
// Sidebar.tsx
{ 
  label: 'Employees', 
  path: '/employees', 
  requiredPermission: 'employee_view'  // Checks if user has this permission
}
```

**Step 3: AuthContext Checks Permission**
```typescript
// AuthContext.tsx
const hasPermission = (permission: string): boolean => {
  if (!user) return false;
  return user.permissions.includes(permission);  // Checks permissions array
}
```

**Step 4: Permissions Are Set Based on Role**
```typescript
// authService.ts
const rolePerms = {
  'company-admin': ['employee_view', 'employee_create', ...],  // All permissions
  'team-leader': ['employee_view', 'attendance_view', ...],    // Limited
  'executive': ['attendance_view', 'task_view', ...]          // Self only
}
```

## Current Limitations

### ❌ What's Missing:
1. **No UI to change user role** after creation
2. **No UI to assign roles to users** in bulk
3. **Roles & Access page doesn't affect actual access** (it's just for documentation)
4. **Can't customize permissions per user** (only per role)

### ✅ What Works:
1. ✅ Role-based sidebar menu filtering
2. ✅ Role-based page access (ProtectedRoute)
3. ✅ Role-based data filtering (e.g., team-leader sees only their department)
4. ✅ Hardcoded 4-role system with predefined permissions

## How to Assign/Change User Roles

### Option 1: During Registration (Company Admin)
When someone registers a company, they automatically become `company-admin`.

### Option 2: Invitation System
When you invite a user, you specify their role:
```typescript
// In your invite system
inviteUser(email, 'team-leader')  // User gets team-leader role
```

### Option 3: Manual Database Update (Not Recommended)
Directly update Firestore:
```javascript
// Update user document
db.collection('users').doc('userId').update({
  role: 'team-leader',
  permissions: ['employee_view', 'attendance_view', ...]
})
```

## Recommended Fix

Add a **User Management** page where you can:
1. View all users
2. Edit user role
3. Assign custom permissions

This should be added to the Employees page or as a new "User Management" section.

## Permission List

| Permission | Description | master-admin | company-admin | team-leader | executive |
|------------|-------------|--------------|---------------|-------------|-----------|
| employee_view | View employees | ✅ | ✅ | ✅ | ❌ |
| employee_create | Add employees | ✅ | ✅ | ❌ | ❌ |
| employee_edit | Edit employees | ✅ | ✅ | ❌ | ❌ |
| employee_delete | Delete employees | ✅ | ✅ | ❌ | ❌ |
| company_view | View company | ✅ | ✅ | ✅ | ✅ |
| company_edit | Edit company | ✅ | ✅ | ❌ | ❌ |
| attendance_view | View attendance | ✅ | ✅ | ✅ | ✅ |
| attendance_edit | Edit attendance | ✅ | ✅ | ✅ | ❌ |
| attendance_approve | Approve attendance | ✅ | ✅ | ✅ | ❌ |
| payroll_view | View salary | ✅ | ✅ | ❌ | ✅ |
| payroll_edit | Edit salary | ✅ | ✅ | ❌ | ❌ |
| task_view | View tasks | ✅ | ✅ | ✅ | ✅ |
| task_create | Create tasks | ✅ | ✅ | ✅ | ❌ |
| task_edit | Edit tasks | ✅ | ✅ | ✅ | ❌ |
| reports_view | View reports | ✅ | ✅ | ✅ | ❌ |
| settings_view | View settings | ✅ | ✅ | ❌ | ✅ |
| role_assign | Assign roles | ✅ | ✅ | ❌ | ❌ |

## Quick Test

To verify roles are working:

1. **Login as Company Admin** → Should see all menu items
2. **Login as Team Leader** → Should see limited menu (no Settings, no Salary editing)
3. **Login as Executive** → Should see only Dashboard, Attendance, Tasks, Profile

Check browser console for permission errors.

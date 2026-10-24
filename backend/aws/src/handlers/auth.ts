/**
 * Auth handlers — Cognito flows + users table.
 *
 * Sign-in / password reset run through Cognito directly from the clients
 * (amazon-cognito-identity-js); this module covers the API-side pieces:
 * profile bootstrap, invitation acceptance, admin staff creation, password
 * reset by code (custom flow kept for web parity), and /me.
 */

import { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminSetUserPasswordCommand, AdminDeleteUserCommand, AdminUpdateUserAttributesCommand, AdminGetUserCommand, AdminInitiateAuthCommand, AuthFlowType, AdminRespondToAuthChallengeCommand, ChallengeNameType } from '@aws-sdk/client-cognito-identity-provider';
import { createHash, randomBytes } from 'node:crypto';
import { must, type Route } from '../lib/http.js';
import { assertRole, assertPermission } from '../lib/auth.js';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { putEntity, getUserDoc, queryEntities, deleteUserDoc, patchEntity, doc, TABLE, userPK } from '../lib/db.js';
import { sendEmailCentral, templates } from '../lib/email.js';
import { createNotification } from '../lib/notify.js';
import { ApiError, newId, isoNow, defaultPermissionsForRole, type UserDoc } from '../lib/types.js';

const cognito = new CognitoIdentityProviderClient({});
const POOL_ID = () => process.env.COGNITO_USER_POOL_ID ?? '';
const CLIENT_ID = () => process.env.COGNITO_CLIENT_ID ?? '';

const APP_URL = () => process.env.APP_URL ?? 'https://hrmax.in';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Input for creating/updating a user document. */
export interface WriteUserInput {
  email: string;
  role: string;
  companyId: string;
  name?: string;
  departmentId?: string | null;
  designation?: string | null;
  avatar?: string;
  permissions?: string[];
  isActive?: boolean;
  status?: UserDoc['status'];
  requirePasswordChange?: boolean;
  createdAt?: string;
  [key: string]: unknown;
}

/** Write users/{uid} doc — MUST run before any token claim points at it. */
export async function writeUserDoc(uid: string, data: WriteUserInput): Promise<UserDoc> {
  const role = data.role as UserDoc['role'];
  const doc_: UserDoc = {
    ...data,
    id: uid,
    email: data.email,
    name: data.name ?? '',
    role,
    companyId: data.companyId,
    permissions: data.permissions ?? defaultPermissionsForRole(role),
    isActive: data.isActive ?? true,
    status: data.status ?? 'Active',
    avatar: data.avatar ?? `https://ui-avatars.com/api/?name=${encodeURIComponent(data.name ?? data.email)}&background=f97316&color=fff`,
    createdAt: data.createdAt ?? isoNow(),
    updatedAt: isoNow(),
  } as UserDoc;
  // GSI2 needs companyId on the item; use 'global' bucket for platform roles
  const gsiCompanyId = doc_.role === 'master-admin' ? 'global' : doc_.companyId || 'global';
  await putEntity<UserDoc>({ ...doc_, companyId: gsiCompanyId }, { entity: 'user', userIdField: 'id' });
  // Users must also be reachable by their real companyId for company queries —
  // we store twice only for platform roles whose companyId is synthetic.
  if (gsiCompanyId !== doc_.companyId) {
    await putEntity<UserDoc>(doc_, { entity: 'user' });
  }
  // Profile copy under USER#{uid}/PROFILE — resolveCaller reads THIS row on
  // every authenticated request (getUserDoc), so it must always exist.
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        PK: userPK(uid),
        SK: 'PROFILE',
        entity: 'user',
        companyId: gsiCompanyId,
        docId: uid,
        data: doc_,
        updatedAt: isoNow(),
      },
    }),
  );
  return doc_;
}

/** Admin-create a Cognito user + set password + custom attributes. */
export async function cognitoCreateUser(email: string, password: string, name: string, role: string, companyId: string): Promise<string> {
  const res = await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: POOL_ID(),
      Username: email,
      MessageAction: 'SUPPRESS',
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'name', Value: name },
        { Name: 'custom:role', Value: role },
        { Name: 'custom:companyId', Value: companyId },
      ],
    }),
  );
  const uid = res.User?.Username ?? email;
  await cognito.send(
    new AdminSetUserPasswordCommand({ UserPoolId: POOL_ID(), Username: uid, Password: password, Permanent: true }),
  );
  return uid;
}

/** Issue a JWT pair via Cognito (used by server-to-server flows; clients normally authenticate directly). */
export async function cognitoSignIn(email: string, password: string) {
  const res = await cognito.send(
    new AdminInitiateAuthCommand({
      UserPoolId: POOL_ID(),
      ClientId: CLIENT_ID(),
      AuthFlow: AuthFlowType.ADMIN_USER_PASSWORD_AUTH,
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }),
  );
  return res.AuthenticationResult;
}

/** Look up a Cognito user by email (Username === email). Returns null when absent. */
export async function cognitoGetUserByEmail(email: string): Promise<{ uid: string; email: string; name?: string } | null> {
  try {
    const res = await cognito.send(new AdminGetUserCommand({ UserPoolId: POOL_ID(), Username: email }));
    const attrs = res.UserAttributes ?? [];
    const get = (n: string) => attrs.find((a) => a.Name === n)?.Value;
    return { uid: res.Username ?? email, email: get('email') ?? email, name: get('name') };
  } catch {
    return null;
  }
}

/** Hard-delete a Cognito user (best-effort; never throws). */
export async function cognitoDeleteUser(uidOrEmail: string): Promise<boolean> {
  try {
    await cognito.send(new AdminDeleteUserCommand({ UserPoolId: POOL_ID(), Username: uidOrEmail }));
    return true;
  } catch {
    return false;
  }
}

/** Update Cognito attributes (best-effort; never throws). */
export async function cognitoUpdateUserAttributes(uidOrEmail: string, attrs: { Name: string; Value: string }[]): Promise<void> {
  try {
    await cognito.send(new AdminUpdateUserAttributesCommand({ UserPoolId: POOL_ID(), Username: uidOrEmail, UserAttributes: attrs }));
  } catch {
    /* non-fatal */
  }
}

// Reset codes (kept server-side in DynamoDB with 10-min TTL semantics)
interface ResetCodeDoc {
  id: string;
  companyId: string;
  email: string;
  code: string;
  expiresAt: string;
  used: boolean;
}

export const authRoutes: Route[] = [
  // ------------------------------------------------------------------ /me
  {
    method: 'GET',
    path: '/api/me',
    handler: async (req) => {
      const caller = must(req);
      const doc_ = await getUserDoc(caller.uid);
      if (!doc_) throw new ApiError('not-found', 'Profile not found');
      return { user: doc_, claims: { role: caller.role, companyId: caller.companyId } };
    },
  },

  // -------------------------------------------------- last-login tracking
  {
    method: 'POST',
    path: '/api/auth/last-login',
    handler: async (req) => {
      const caller = must(req);
      await patchEntity('user', caller.companyId || 'global', caller.uid, { lastLoginAt: isoNow() }, { entity: 'user' });
      return { success: true };
    },
  },

  // ------------------------------------------------- push token registration
  {
    method: 'POST',
    path: '/api/auth/push-token',
    handler: async (req) => {
      const caller = must(req);
      const token = String(req.body.token ?? '');
      await patchEntity('user', caller.companyId || 'global', caller.uid, { pushToken: token || null }, { entity: 'user' });
      return { success: true };
    },
  },

  // ------------------------------------------------------- forgot password
  {
    method: 'POST',
    path: '/api/auth/forgot-password',
    public: true,
    handler: async (req) => {
      const email = String(req.body.email ?? '').trim().toLowerCase();
      if (!email) throw new ApiError('bad-request', 'email required');
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await putEntity<ResetCodeDoc>(
        {
          id: newId(),
          companyId: 'global',
          email,
          code: createHash('sha256').update(code).digest('hex'),
          expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
          used: false,
        },
        { entity: 'resetCode' },
      );
      const t = templates.resetCode(code);
      await sendEmailCentral({ to: email, subject: t.subject, html: t.html, type: 'otp', dedupKey: `reset-code-${email}-${code}` });
      return { success: true };
    },
  },

  {
    method: 'POST',
    path: '/api/auth/reset-password',
    public: true,
    handler: async (req) => {
      const email = String(req.body.email ?? '').trim().toLowerCase();
      const code = String(req.body.code ?? '');
      const newPassword = String(req.body.newPassword ?? '');
      if (!email || !code || !newPassword) throw new ApiError('bad-request', 'email, code, newPassword required');

      const codes = await queryEntities<ResetCodeDoc>({ entity: 'resetCode', companyId: 'global', filters: { email, used: false }, limit: 10 });
      const match = codes.find((c) => c.code === createHash('sha256').update(code).digest('hex') && new Date(c.expiresAt).getTime() > Date.now());
      if (!match) throw new ApiError('bad-request', 'Invalid or expired code');

      await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId: POOL_ID(), Username: email, Password: newPassword, Permanent: true }));
      await patchEntity('resetCode', 'global', match.id, { used: true }, { entity: 'resetCode' });
      return { success: true };
    },
  },

  // Verify-only step for the 3-screen reset UI (email → code → new password).
  // Checks the same SHA-256 hash + expiry without consuming or resetting.
  {
    method: 'POST',
    path: '/api/auth/verify-reset-code',
    public: true,
    handler: async (req) => {
      const email = String(req.body.email ?? '').trim().toLowerCase();
      const code = String(req.body.code ?? '');
      if (!email || !code) throw new ApiError('bad-request', 'email, code required');
      const codes = await queryEntities<ResetCodeDoc>({ entity: 'resetCode', companyId: 'global', filters: { email, used: false }, limit: 10 });
      const valid = codes.some((c) => c.code === createHash('sha256').update(code).digest('hex') && new Date(c.expiresAt).getTime() > Date.now());
      return { valid };
    },
  },

  // --------------------------------------------- change password (self)
  {
    method: 'POST',
    path: '/api/auth/change-password',
    handler: async (req) => {
      const caller = must(req);
      const current = String(req.body.currentPassword ?? '');
      const next = String(req.body.newPassword ?? '');
      if (!current || !next) throw new ApiError('bad-request', 'currentPassword and newPassword required');
      // verify current password
      try {
        await cognitoSignIn(caller.email, current);
      } catch {
        throw new ApiError('bad-request', 'Current password is incorrect');
      }
      await cognito.send(
        new AdminSetUserPasswordCommand({ UserPoolId: POOL_ID(), Username: caller.email, Password: next, Permanent: true }),
      );
      await patchEntity('user', caller.companyId || 'global', caller.uid, { requirePasswordChange: false }, { entity: 'user' });
      return { success: true };
    },
  },

  // ------------------------------------------- accept invitation (public)
  {
    method: 'POST',
    path: '/api/auth/accept-invite',
    public: true,
    handler: async (req) => {
      const token = String(req.body.token ?? '');
      const email = String(req.body.email ?? '').trim().toLowerCase();
      const password = String(req.body.password ?? '');
      const name = String(req.body.name ?? '');
      if (!token || !email || !password || !name) throw new ApiError('bad-request', 'token, email, password, name required');

      const invites = await queryEntities<Record<string, unknown>>({ entity: 'invitation', companyId: 'global', filters: { token, status: 'pending' }, limit: 5 });
      const invite = invites.find((i) => String(i.email ?? '').toLowerCase() === email);
      if (!invite) throw new ApiError('bad-request', 'Invitation not found or already used');
      if (new Date(String(invite.expiresAt)).getTime() < Date.now()) throw new ApiError('bad-request', 'Invitation expired');

      const role = String(invite.role ?? 'employee');
      const companyId = String(invite.companyId ?? '');
      const uid = await cognitoCreateUser(email, password, name, role, companyId);

      const doc_ = await writeUserDoc(uid, {
        email, name, role, companyId,
        departmentId: (invite.departmentId as string) ?? null,
        permissions: defaultPermissionsForRole(role as UserDoc['role']),
        isActive: true,
        status: 'Active',
      });

      // Link/create employee record
      const employeeId = (invite.employeeId as string) ?? null;
      if (employeeId) {
        await patchEntity('employee', companyId, employeeId, { userId: uid, name }, { entity: 'employee', userIdField: 'userId' });
      } else if (role === 'team-leader' || role === 'executive') {
        await putEntity(
          { id: newId(), companyId, userId: uid, name, email, role, status: 'Active', createdAt: isoNow() },
          { entity: 'employee', userIdField: 'userId' },
        );
      }

      await patchEntity('invitation', 'global', String(invite.id), { status: 'accepted', acceptedBy: uid, acceptedAt: isoNow() }, { entity: 'invitation', keyCompanyId: 'global' });
      return { user: doc_ };
    },
  },

  // --------------------------------------------- invite user (protected)
  {
    method: 'POST',
    path: '/api/auth/invite',
    handler: async (req) => {
      const caller = must(req);
      assertRole(caller, ['master-admin', 'company-admin', 'team-leader', 'executive']);
      const email = String(req.body.email ?? '').trim().toLowerCase();
      const role = String(req.body.role ?? 'employee');
      const name = String(req.body.name ?? '');
      const companyId = String(req.body.companyId ?? caller.companyId);
      const departmentId = (req.body.departmentId as string) ?? null;
      const employeeId = (req.body.employeeId as string) ?? null;
      if (!email || !name) throw new ApiError('bad-request', 'email and name required');

      const token = randomBytes(32).toString('hex');
      const inviteId = newId();
      await putEntity(
        {
          id: inviteId,
          email, name, role, companyId, departmentId, employeeId,
          token,
          status: 'pending',
          invitedBy: caller.uid,
          invitedByName: caller.name,
          expiresAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
          createdAt: isoNow(),
        },
        { entity: 'invitation', globalList: true, keyCompanyId: 'global' },
      );

      const inviteLink = `${APP_URL()}/accept-invite?token=${token}`;
      const t = templates.invitation(name, inviteLink, caller.name || 'Your administrator');
      await sendEmailCentral({ to: email, subject: t.subject, html: t.html, type: 'invite', companyId });

      return { inviteId, inviteLink };
    },
  },

  {
    method: 'GET',
    path: '/api/auth/invitations',
    handler: async (req) => {
      const caller = must(req);
      const all = await queryEntities<Record<string, unknown>>({ entity: 'invitation', companyId: 'global', global: true, limit: 500 });
      const scoped = isSuper(caller) ? all : all.filter((i) => i.invitedBy === caller.uid || i.companyId === caller.companyId);
      return { invitations: scoped };
    },
  },

  {
    method: 'POST',
    path: '/api/auth/invitations/:id/cancel',
    handler: async (req) => {
      const caller = must(req);
      const id = req.params.id;
      const all = await queryEntities<Record<string, unknown>>({ entity: 'invitation', companyId: 'global', global: true, filters: { id }, limit: 1 });
      const invite = all[0];
      if (!invite) throw new ApiError('not-found', 'Invitation not found');
      if (!isSuper(caller) && invite.invitedBy !== caller.uid) throw new ApiError('permission-denied', 'Not your invitation');
      await patchEntity('invitation', 'global', id, { status: 'cancelled' }, { entity: 'invitation', keyCompanyId: 'global' });
      return { success: true };
    },
  },

  // ------------------------------------- invitation token probe (public)
  {
    method: 'GET',
    path: '/api/auth/invitation/:token',
    public: true,
    handler: async (req) => {
      const token = req.params.token;
      const invites = await queryEntities<Record<string, unknown>>({ entity: 'invitation', companyId: 'global', filters: { token, status: 'pending' }, limit: 1 });
      const invite = invites[0];
      if (!invite) throw new ApiError('not-found', 'Invitation not found or already used');
      if (new Date(String(invite.expiresAt)).getTime() < Date.now()) throw new ApiError('bad-request', 'Invitation expired');
      return { email: invite.email, name: invite.name, role: invite.role, company: invite.companyName ?? null };
    },
  },

  // --------------------------------------------- create staff (admin)
  {
    method: 'POST',
    path: '/api/users/create-staff',
    handler: async (req) => {
      const caller = must(req);
      assertPermission(caller, 'employees.create');
      const { email, name, role, companyId, departmentId, designation, tempPassword } = req.body as Record<string, string>;
      if (!email || !name || !role) throw new ApiError('bad-request', 'email, name, role required');
      const password = tempPassword ?? `Hr@${randomBytes(4).toString('hex')}123`;
      const cid = companyId || caller.companyId;

      const uid = await cognitoCreateUser(email, password, name, role, cid);
      const doc_ = await writeUserDoc(uid, {
        email, name, role, companyId: cid,
        departmentId: departmentId ?? null,
        designation: designation ?? null,
        permissions: defaultPermissionsForRole(role as UserDoc['role']),
        requirePasswordChange: true,
        status: 'Active',
        isActive: true,
      });

      const t = templates.welcome(name, password);
      await sendEmailCentral({ to: email, subject: t.subject, html: t.html, type: 'welcome', companyId: cid });

      await createNotification({
        userId: caller.uid, companyId: cid, type: 'account_created',
        title: `${name} account created`, message: `${role} account for ${name} is ready.`,
      });
      return { uid, user: doc_ };
    },
  },

  {
    method: 'DELETE',
    path: '/api/users/:uid',
    handler: async (req) => {
      const caller = must(req);
      assertRole(caller, ['master-admin']);
      const uid = req.params.uid;
      if (uid === caller.uid) throw new ApiError('bad-request', 'Cannot delete your own account');
      await cognito.send(new AdminDeleteUserCommand({ UserPoolId: POOL_ID(), Username: uid })).catch(() => undefined);
      await deleteUserDoc(uid);
      return { success: true };
    },
  },
];

function isSuper(caller: { role: string }) {
  return caller.role === 'master-admin';
}

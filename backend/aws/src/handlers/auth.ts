/**
 * Auth handlers — Cognito flows + users table.
 *
 * Sign-in / password reset run through Cognito directly from the clients
 * (amazon-cognito-identity-js); this module covers the API-side pieces:
 * profile bootstrap, invitation acceptance, admin staff creation, password
 * reset by code (custom flow kept for web parity), and /me.
 */

import { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminSetUserPasswordCommand, AdminDeleteUserCommand, AdminUpdateUserAttributesCommand, AdminGetUserCommand, InitiateAuthCommand, AuthFlowType, AdminRespondToAuthChallengeCommand, ChallengeNameType } from '@aws-sdk/client-cognito-identity-provider';
import { createHash, randomBytes } from 'node:crypto';
import { must, type Route } from '../lib/http.js';
import { assertRole, assertPermission, scopedCompanyIds } from '../lib/auth.js';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { putEntity, getUserDoc, queryEntities, deleteUserDoc, patchEntity, patchUserDoc, getEntity, doc, TABLE, userPK, allUsers } from '../lib/db.js';
import { sendEmailCentral, templates } from '../lib/email.js';
import { createNotification } from '../lib/notify.js';
import { enforceRateLimit } from '../lib/rateLimit.js';
import { ApiError, newId, isoNow, defaultPermissionsForRole, VALID_ROLES, type UserDoc, type UserRole } from '../lib/types.js';

const cognito = new CognitoIdentityProviderClient({});
const POOL_ID = () => process.env.COGNITO_USER_POOL_ID ?? '';
const CLIENT_ID = () => process.env.COGNITO_CLIENT_ID ?? '';

/** Client IP for rate-limit buckets on public routes (caller is null there). */
const sourceIp = (req: { raw: { requestContext: { http: { sourceIp?: string } } } }): string =>
  String(req.raw?.requestContext?.http?.sourceIp ?? 'unknown');

const APP_URL = () => process.env.APP_URL ?? 'https://hrmax.in';

// ---------------------------------------------------------------------------
// Password policy (single source of truth for every server-side password set)
// ---------------------------------------------------------------------------
// Matches the frontend policy (frontend/src/utils/passwordPolicy.ts). Enforced
// ONLY on new-password paths (reset, change, invite, admin-created staff) so
// existing accounts with historical passwords can still sign in untouched.
export function validatePasswordPolicy(password: string): { valid: boolean; message?: string } {
  if (typeof password !== 'string' || password.length === 0) {
    return { valid: false, message: 'Password is required.' };
  }
  if (password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters long.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one uppercase letter (A-Z).' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one lowercase letter (a-z).' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one number (0-9).' };
  }
  if (!/[!@#$%&*]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one special symbol (! @ # $ % & *).' };
  }
  return { valid: true };
}

/** Best-effort security email + audit trail for password events (never throws,
 *  never logs the password itself). */
async function recordPasswordEvent(opts: {
  uid: string; email: string; name?: string; companyId: string;
  action: 'PASSWORD_RESET_COMPLETED' | 'PASSWORD_CHANGED';
  ip?: string; userAgent?: string;
}): Promise<void> {
  try {
    const t = templates.passwordChanged(opts.name ?? '');
    await sendEmailCentral({
      to: opts.email,
      subject: t.subject,
      html: t.html,
      type: 'system',
      companyId: opts.companyId,
      dedupKey: `password-event-${opts.uid}-${opts.action}-${Date.now()}`,
    });
  } catch (e) {
    console.warn('[auth] password-event email failed (best-effort):', e instanceof Error ? e.message : String(e));
  }
  try {
    await putEntity(
      {
        id: newId(),
        companyId: opts.companyId || 'global',
        action: opts.action,
        actorId: opts.uid,
        actorName: opts.name ?? '',
        targetId: opts.uid,
        details: 'Password updated via self-service flow',
        ip: opts.ip ?? '',
        userAgent: opts.userAgent ?? '',
        createdAt: isoNow(),
        timestamp: isoNow(),
      },
      { entity: 'auditLog', globalList: true, tsField: 'createdAt' },
    );
  } catch (e) {
    console.warn('[auth] password-event audit failed (best-effort):', e instanceof Error ? e.message : String(e));
  }
}

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

/** Admin-create a Cognito user + set password + custom attributes.
 *
 * Cognito's client errors are translated into ApiError so the caller sees an
 * actionable message instead of the generic 500 "Internal server error".
 * The one that bit us in production: UsernameExistsException (an email that is
 * already registered) surfaced as a bare 500 on every Add Team Leader /
 * Add Employee / Add Executive / Add Company Admin attempt, because the raw
 * SDK error escaped the handler's own error mapping.
 */
export async function cognitoCreateUser(email: string, password: string, name: string, role: string, companyId: string): Promise<string> {
  let res: { User?: { Username?: string } };
  try {
    res = await cognito.send(
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
  } catch (err) {
    throw mapCognitoCreateError(err, email);
  }
  const uid = res.User?.Username ?? email;
  try {
    await cognito.send(
      new AdminSetUserPasswordCommand({ UserPoolId: POOL_ID(), Username: uid, Password: password, Permanent: true }),
    );
  } catch (err) {
    // The account now exists but has no usable password - clean it up so a
    // retry with the same email is not blocked by a half-created user.
    await cognito.send(new AdminDeleteUserCommand({ UserPoolId: POOL_ID(), Username: uid })).catch(() => undefined);
    throw mapCognitoCreateError(err, email);
  }
  return uid;
}

/** Turn Cognito's SDK errors during account creation into actionable ApiErrors. */
function mapCognitoCreateError(err: unknown, email: string): ApiError {
  const name = (err as { name?: string; __type?: string }).name
    ?? (err as { __type?: string }).__type
    ?? '';
  const message = err instanceof Error ? err.message : '';
  if (name.includes('UsernameExists') || name.includes('AliasExists')) {
    return new ApiError(
      'bad-request',
      `An account with ${email} already exists. Use Reset Password for that user, or change their role in Access Management.`,
    );
  }
  if (name.includes('InvalidPassword') || name.includes('PasswordInvalid')) {
    return new ApiError('bad-request', message || 'Password does not meet the requirements.');
  }
  if (name.includes('InvalidParameter')) {
    return new ApiError('bad-request', message || 'Some account details are not valid.');
  }
  console.error('[auth] cognito create failed:', name, message);
  return new ApiError('internal', 'Could not create the account right now. Please try again.');
}

/** Issue a JWT pair via Cognito (used by server-to-server flows; clients normally authenticate directly). */
export async function cognitoSignIn(email: string, password: string) {
  // USER_PASSWORD_AUTH (client-side flow enabled on the app client), NOT
  // AdminInitiateAuth: the pool only allows ALLOW_USER_PASSWORD_AUTH /
  // ALLOW_USER_SRP_AUTH / ALLOW_REFRESH_TOKEN_AUTH, so an ADMIN_USER_PASSWORD
  // auth attempt throws and every change-password reported "Current password
  // is incorrect" no matter what the user typed. This authenticates the same
  // credentials the sign-in screen uses.
  const res = await cognito.send(
    new InitiateAuthCommand({
      ClientId: CLIENT_ID(),
      AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
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

  // --------------------------------------- resolve System Username -> email
  // The sign-in box accepts a user's System Username (e.g. the Company
  // Admin's info@sofixs.com) in addition to the account email. Cognito
  // usernames are always the email (pool UsernameAttributes = email, no
  // aliases possible), so the client tries the typed name first and — only on
  // UserNotFoundException — asks THIS endpoint which email (if any) the
  // System Username belongs to, then retries InitiateAuth with that email.
  // Unknown names come back as { email: null } so the UI keeps its normal
  // "no account found" error. Rate-limited like every other public auth route.
  {
    method: 'POST',
    path: '/api/auth/resolve-username',
    public: true,
    handler: async (req) => {
      const username = String(req.body.username ?? '').trim().toLowerCase();
      if (!username) throw new ApiError('bad-request', 'username required');
      await enforceRateLimit(`resolveuser#${username}`, 15, 300);
      await enforceRateLimit(`resolveuser-ip#${sourceIp(req)}`, 60, 300);

      // An email is already a Cognito username — nothing to resolve.
      if (username.includes('@')) return { email: username };

      // Usernames are stored as-typed by the admin forms, so compare them
      // case-insensitively. allUsers() is the same full-union read the
      // Master Admin's user listing performs; the rate limit above bounds
      // repeated attempts.
      const all = await allUsers();
      const hit = all.find(
        (u) => String(u.username ?? '').trim().toLowerCase() === username && u.isActive !== false,
      );
      return { email: hit ? String(hit.email ?? '').toLowerCase() : null };
    },
  },

  // ------------------------------------------------------- forgot password
  // Anti-enumeration: ALWAYS returns { success: true } whether or not the
  // account exists. A reset code is only created (and emailed) when the
  // address matches a real Cognito account, so an attacker learns nothing
  // from the response, and no orphan code/email documents are written.
  {
    method: 'POST',
    path: '/api/auth/forgot-password',
    public: true,
    handler: async (req) => {
      const email = String(req.body.email ?? '').trim().toLowerCase();
      if (!email) throw new ApiError('bad-request', 'email required');
      await enforceRateLimit(`forgot#${email}`, 8, 300);
      await enforceRateLimit(`forgot-ip#${sourceIp(req)}`, 30, 300);

      const account = await cognitoGetUserByEmail(email);
      if (!account) {
        // Simulate the same success path without touching data or email.
        return { success: true };
      }

      // Only one active code per address: retire previous unused codes so an
      // attacker-supplied older code cannot race a freshly requested one.
      try {
        const old = await queryEntities<ResetCodeDoc>({ entity: 'resetCode', companyId: 'global', filters: { email, used: false }, limit: 10 });
        for (const c of old) {
          await patchEntity('resetCode', 'global', String(c.id), { used: true }, { entity: 'resetCode' }).catch(() => undefined);
        }
      } catch (e) {
        console.warn('[auth] retiring old reset codes failed (best-effort):', e instanceof Error ? e.message : String(e));
      }

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
      const result = await sendEmailCentral({ to: email, subject: t.subject, html: t.html, type: 'otp', dedupKey: `reset-code-${email}-${code}` });
      if (!result.success) {
        // Do NOT fail the request (that would leak sendability + differ from
        // the unknown-account path); the delivery attempt is logged by
        // sendEmailCentral for the Email Center retry flow.
        console.warn('[auth] reset-code email not delivered:', result.error ?? result.skipped);
      }
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
      await enforceRateLimit(`reset#${email}`, 10, 300);
      await enforceRateLimit(`reset-ip#${sourceIp(req)}`, 30, 300);

      const policy = validatePasswordPolicy(newPassword);
      if (!policy.valid) throw new ApiError('bad-request', policy.message ?? 'Password does not meet the requirements.');

      const codes = await queryEntities<ResetCodeDoc>({ entity: 'resetCode', companyId: 'global', filters: { email, used: false }, limit: 10 });
      const match = codes.find((c) => c.code === createHash('sha256').update(code).digest('hex') && new Date(c.expiresAt).getTime() > Date.now());
      if (!match) throw new ApiError('bad-request', 'Invalid or expired code');

      await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId: POOL_ID(), Username: email, Password: newPassword, Permanent: true }));

      // Burn EVERY active code for this address (single-use guarantee — the
      // matched code plus any parallel request an attacker might hold).
      for (const c of codes) {
        await patchEntity('resetCode', 'global', String(c.id), { used: true }, { entity: 'resetCode' }).catch(() => undefined);
      }

      // Security notification + audit trail (best-effort, never blocks the reset).
      const account = await cognitoGetUserByEmail(email).catch(() => null);
      if (account) {
        const profile = await getUserDoc(account.uid).catch(() => null);
        await recordPasswordEvent({
          uid: account.uid,
          email,
          name: (profile?.name as string) ?? account.name ?? '',
          companyId: String(profile?.companyId ?? 'global'),
          action: 'PASSWORD_RESET_COMPLETED',
          ip: req.caller?.ip,
          userAgent: req.caller?.userAgent,
        });
      }
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
      await enforceRateLimit(`verify#${email}`, 20, 300);
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
      await enforceRateLimit(`chpw#${caller.uid}`, 15, 300);
      if (current === next) throw new ApiError('bad-request', 'New password must be different from the current password.');
      const policy = validatePasswordPolicy(next);
      if (!policy.valid) throw new ApiError('bad-request', policy.message ?? 'Password does not meet the requirements.');
      // verify current password
      try {
        await cognitoSignIn(caller.email, current);
      } catch {
        throw new ApiError('bad-request', 'Current password is incorrect');
      }
      await cognito.send(
        new AdminSetUserPasswordCommand({ UserPoolId: POOL_ID(), Username: caller.email, Password: next, Permanent: true }),
      );
      // Clear the temporary-password flag on PROFILE — the row every read
      // path (GET /api/users/:id, resolveCaller) actually uses. Clearing only
      // the company-partition copy left the flag set on the copy the app
      // reads, so the user was bounced straight back to
      // /force-password-change right after a successful change. Best-effort:
      // the password IS changed at this point, and swallowing lets the user
      // simply change again (a thrown 500 here would strand them on the old
      // current-password field).
      await patchUserDoc(caller.uid, { requirePasswordChange: false })
        .catch((e) => console.error('[auth] change-password: could not clear requirePasswordChange:', e instanceof Error ? e.message : String(e)));
      await patchEntity('user', caller.companyId || 'global', caller.uid, { requirePasswordChange: false }, { entity: 'user' })
        .catch((e) => console.warn('[auth] change-password: partition copy not updated:', e instanceof Error ? e.message : String(e)));
      await recordPasswordEvent({
        uid: caller.uid,
        email: caller.email,
        name: caller.name,
        companyId: caller.companyId || 'global',
        action: 'PASSWORD_CHANGED',
        ip: caller.ip,
        userAgent: caller.userAgent,
      });
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
      await enforceRateLimit(`invite-ip#${sourceIp(req)}`, 20, 300);
      const policy = validatePasswordPolicy(password);
      if (!policy.valid) throw new ApiError('bad-request', policy.message ?? 'Password does not meet the requirements.');

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
      const { email, name, role, companyId, departmentId, designation, tempPassword, password: webPassword, username, primaryBranchId, branchIds } = req.body as Record<string, string> & { branchIds?: unknown };
      if (!email || !name || !role) throw new ApiError('bad-request', 'email, name, role required');
      // Roles come from client forms — reject anything that is not a real role
      // (an unknown string would be stored, then rejected on every request by
      // resolveCaller, leaving a login nobody can use).
      if (!VALID_ROLES.includes(role as UserRole)) {
        throw new ApiError('bad-request', `Unknown role: ${role}`);
      }
      // Web (Companies.tsx) sends `password`; mobile/legacy callers send `tempPassword`.
      const password = tempPassword ?? webPassword ?? `Hr@${randomBytes(4).toString('hex')}123`;
      // Enforce the shared policy only when the caller chose the password
      // (server-generated temp passwords already comply: mixed case + symbol + digits).
      if (tempPassword ?? webPassword) {
        const policy = validatePasswordPolicy(password);
        if (!policy.valid) throw new ApiError('bad-request', policy.message ?? 'Password does not meet the requirements.');
      }
      const cid = companyId || caller.companyId;

      // Branch assignment: every id must exist INSIDE this company before the
      // account is created — permissions are enforced server-side at punch
      // time, so they must be server-validated at assignment time too.
      const extraBranches = Array.isArray(branchIds) ? branchIds.map(String).filter(Boolean) : [];
      const allBranches = [...new Set([String(primaryBranchId ?? ''), ...extraBranches].filter(Boolean))];
      for (const bid of allBranches) {
        const br = await getEntity<Record<string, unknown>>('branch', cid, bid);
        if (!br) throw new ApiError('bad-request', 'One of the selected branches does not belong to this company.');
      }

      const uid = await cognitoCreateUser(email, password, name, role, cid);
      const doc_ = await writeUserDoc(uid, {
        email, name, role, companyId: cid,
        departmentId: departmentId ?? null,
        designation: designation ?? null,
        username: username ?? null,
        primaryBranchId: primaryBranchId || null,
        branchIds: extraBranches,
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
      return { success: true, uid, user: doc_ };
    },
  },

  // --------------------------- admin-triggered password reset (any role)
  // ONE flow for every role an admin can manage (employee, company admin,
  // executive, team leader): the caller receives a temporary password, hands
  // it to the account holder, and that user is forced to replace it with a
  // permanent one - at sign-in the app redirects to /force-password-change
  // while `requirePasswordChange` is set, and Settings -> Change Password
  // clears it any time later. The temporary password is returned only in this
  // response: it is never written to an email or notification.
  {
    method: 'POST',
    path: '/api/users/reset-password',
    handler: async (req) => {
      const caller = must(req);
      assertRole(caller, ['master-admin', 'company-admin', 'executive', 'team-leader']);
      const email = String(req.body.email ?? '').trim().toLowerCase();
      if (!email) throw new ApiError('bad-request', 'email required');
      // Optional admin-CHOSEN password (Company edit -> Account Credentials):
      // when supplied, use it verbatim instead of the random temp password.
      const chosenPassword = String(req.body.password ?? '').trim();
      await enforceRateLimit(`adminreset#${email}`, 10, 300);
      await enforceRateLimit(`adminreset-ip#${sourceIp(req)}`, 40, 300);

      const account = await cognitoGetUserByEmail(email);
      if (!account) throw new ApiError('not-found', `No HR MAX account exists for ${email}.`);

      const targetDoc = await getUserDoc(account.uid).catch(() => null);
      const targetCompany = String((targetDoc?.companyId as string) ?? '');
      if (!isSuper(caller)) {
        const scope = scopedCompanyIds(caller);
        if (targetCompany && scope.length > 0 && !scope.includes(targetCompany)) {
          throw new ApiError('permission-denied', 'You can only reset passwords for users in your assigned companies.');
        }
      }

      // Complies with both the shared app policy and the Cognito pool:
      // upper + lower + digit + symbol, >= 8 chars. The random hex can be
      // letter-only, so the appended digits guarantee the digit class. A
      // caller-chosen password must clear the same policy (bad-request, the
      // admin can fix it in the form); only a broken *generated* one is
      // an internal error.
      const tempPassword = chosenPassword
        || `Hr@${randomBytes(4).toString('hex')}${1000 + Math.floor(Math.random() * 9000)}`;
      const policy = validatePasswordPolicy(tempPassword);
      if (!policy.valid) {
        throw new ApiError(
          chosenPassword ? 'bad-request' : 'internal',
          policy.message ?? 'Could not generate a temporary password. Please try again.',
        );
      }

      try {
        await cognito.send(
          new AdminSetUserPasswordCommand({ UserPoolId: POOL_ID(), Username: account.uid, Password: tempPassword, Permanent: true }),
        );
      } catch (err) {
        console.error('[auth] admin reset: AdminSetUserPassword failed:', err instanceof Error ? err.message : String(err));
        throw new ApiError('internal', 'Could not reset the password right now. Please try again.');
      }

      // Mark the account so the next sign-in lands on /force-password-change
      // and the user picks their own permanent password. PROFILE is the row
      // the app reads for that decision; the company-partition copy is kept
      // in sync for the user lists.
      await patchUserDoc(account.uid, { requirePasswordChange: true })
        .catch((e) => console.warn('[auth] admin reset: could not set requirePasswordChange:', e instanceof Error ? e.message : String(e)));
      if (targetDoc) {
        await patchEntity('user', targetCompany || 'global', account.uid, { requirePasswordChange: true }, { entity: 'user' })
          .catch((e) => console.warn('[auth] admin reset: could not set requirePasswordChange (partition):', e instanceof Error ? e.message : String(e)));
      }

      // Security email to the account holder - never the password itself.
      try {
        const t = templates.passwordChanged(String((targetDoc?.name as string) ?? ''));
        await sendEmailCentral({
          to: email,
          subject: t.subject,
          html: t.html,
          type: 'system',
          companyId: targetCompany || 'global',
          dedupKey: `admin-reset-${email}-${Date.now()}`,
        });
      } catch (e) {
        console.warn('[auth] admin reset security email failed (best-effort):', e instanceof Error ? e.message : String(e));
      }

      // In-app copy: how to use the temporary password the admin handed over.
      await createNotification({
        userId: account.uid,
        companyId: targetCompany || 'global',
        type: 'security',
        title: 'Your password was reset',
        message: `${caller.name || 'Your administrator'} reset your password. Sign in with the temporary password you were given - you will be asked to choose a new permanent one right away.`,
        link: '/force-password-change',
      }).catch(() => undefined);

      // Audit trail: who initiated it, against whom.
      await putEntity(
        {
          id: newId(),
          companyId: caller.companyId || 'global',
          action: 'PASSWORD_RESET_COMPLETED',
          actorId: caller.uid,
          actorName: caller.name ?? '',
          targetId: account.uid,
          details: `Admin-issued ${chosenPassword ? 'password' : 'temporary password'} for ${email}`,
          ip: sourceIp(req),
          userAgent: '',
          createdAt: isoNow(),
          timestamp: isoNow(),
        },
        { entity: 'auditLog', globalList: true, tsField: 'createdAt' },
      ).catch((e) => console.warn('[auth] admin reset audit failed (best-effort):', e instanceof Error ? e.message : String(e)));

      return { success: true, email, tempPassword };
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

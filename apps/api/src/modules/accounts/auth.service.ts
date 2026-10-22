import type { CurrentUser, InvitationInfo, Permission, UpdatePreferencesInput } from '@hrm/contracts';
import { schema } from '@hrm/db';
import { and, eq, sql } from 'drizzle-orm';
import { recordAudit } from '../../lib/audit';
import type { AuthContext } from '../../lib/auth-context';
import { sha256Hex } from '../../lib/crypto';
import type { Deps } from '../../lib/deps';
import { notFound } from '../../lib/problem';

/** `GET /auth/me` (AUTH-IMPLEMENTATION §9). A weak privileged session lists only non-privileged permissions. */
export async function currentUser(deps: Deps, auth: AuthContext): Promise<CurrentUser> {
  const [enrolment] = await deps.db.execute<{ has_passkey: boolean; has_totp: boolean }>(sql`
    SELECT EXISTS (SELECT 1 FROM passkeys WHERE user_id = ${auth.userId}) AS has_passkey,
           EXISTS (SELECT 1 FROM two_factors WHERE user_id = ${auth.userId} AND verified) AS has_totp`);
  const permissions: Permission[] =
    auth.mfaRequired && !auth.strongAuth ? [...auth.weakPermissions] : auth.permissions;
  return {
    user: { ...auth.user },
    employee: auth.employee,
    roles: [...auth.roles],
    permissions: permissions.sort(),
    session: {
      authMethod: auth.session.authMethod,
      strongAuth: auth.strongAuth,
      strongAuthAt: auth.session.strongAuthAt?.toISOString() ?? null,
      mfaRequired: auth.mfaRequired,
    },
    enrolment: { hasPasskey: enrolment?.has_passkey ?? false, hasTotp: enrolment?.has_totp ?? false },
  };
}

/** `PATCH /auth/me/preferences`: theme (D-040) and locale. Not audited: personal display preferences only. */
export async function updatePreferences(deps: Deps, auth: AuthContext, input: UpdatePreferencesInput) {
  await deps.db
    .update(schema.users)
    .set({
      ...(input.theme ? { theme: input.theme } : {}),
      ...(input.locale ? { locale: input.locale } : {}),
      updatedAt: deps.clock.now(),
      updatedBy: auth.userId,
    })
    .where(eq(schema.users.id, auth.userId));
  if (input.theme) (auth.user as { theme: string }).theme = input.theme;
  if (input.locale) (auth.user as { locale: string }).locale = input.locale;
  return currentUser(deps, auth);
}

function maskEmail(email: string) {
  const [local = '', domain = ''] = email.split('@');
  const shown = local.slice(0, Math.min(2, local.length));
  return `${shown}${'•'.repeat(Math.max(1, local.length - shown.length))}@${domain}`;
}

async function findOpenInvitation(deps: Deps, token: string) {
  const tokenHash = await sha256Hex(token);
  const [row] = await deps.db
    .select({
      id: schema.invitations.id,
      companyId: schema.invitations.companyId,
      userId: schema.invitations.userId,
      expiresAt: schema.invitations.expiresAt,
      email: schema.users.email,
      status: schema.users.status,
      companyName: schema.companies.name,
    })
    .from(schema.invitations)
    .innerJoin(schema.users, eq(schema.users.id, schema.invitations.userId))
    .innerJoin(schema.companies, eq(schema.companies.id, schema.invitations.companyId))
    .where(
      and(
        eq(schema.invitations.tokenHash, tokenHash),
        sql`${schema.invitations.acceptedAt} IS NULL`,
        sql`${schema.invitations.revokedAt} IS NULL`,
      ),
    );
  // Unknown, used, revoked and expired tokens all look the same (AUTH-IMPLEMENTATION §4).
  if (!row || row.expiresAt < deps.clock.now() || row.status !== 'invited') throw notFound();
  return row;
}

export async function invitationInfo(deps: Deps, token: string): Promise<InvitationInfo> {
  const row = await findOpenInvitation(deps, token);
  return { maskedEmail: maskEmail(row.email), companyName: row.companyName };
}

/** Accepts an invitation: the user becomes active and receives a sign-in code (AUTH-IMPLEMENTATION §4 step 3). */
export async function acceptInvitation(deps: Deps, token: string) {
  const inv = await findOpenInvitation(deps, token);
  const now = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    await tx
      .update(schema.invitations)
      .set({ acceptedAt: now, updatedAt: now })
      .where(eq(schema.invitations.id, inv.id));
    await tx
      .update(schema.users)
      .set({ status: 'active', emailVerified: true, statusChangedAt: now, updatedAt: now })
      .where(and(eq(schema.users.id, inv.userId), eq(schema.users.status, 'invited')));
    await recordAudit(
      tx,
      { companyId: inv.companyId, userId: inv.userId, type: 'user', ...deps.meta },
      {
        action: 'user.invitation_accepted',
        category: 'security',
        entityType: 'user',
        entityId: inv.userId,
      },
    );
  });
  await deps.auth().api.sendVerificationOTP({ body: { email: inv.email, type: 'sign-in' } });
  return { email: inv.email, codeSent: true as const };
}

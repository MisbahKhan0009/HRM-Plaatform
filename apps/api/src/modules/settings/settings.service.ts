import {
  type AuditCategory,
  type FieldError,
  P,
  type Permission,
  SETTING_KEYS,
  SETTINGS,
  type SettingDto,
  type SettingKey,
  type SettingScope,
  type SettingsGroups,
  settingScopeValues,
  type UpdateSettingsInput,
} from '@hrm/contracts';
import { jsonValue, type Queryable, schema, uuidv7 } from '@hrm/db';
import { and, eq, sql } from 'drizzle-orm';
import { recordAudit } from '../../lib/audit';
import type { AuthContext } from '../../lib/auth-context';
import type { Deps } from '../../lib/deps';
import { requireStrong } from '../../lib/guards';
import { forbidden, validationFailed, versionConflict } from '../../lib/problem';

const { settings, settingsHistory } = schema;

const MANAGE: Record<SettingScope, Permission> = {
  technical: P.settings.technical.manage,
  hr: P.settings.hr.manage,
  payroll: P.settings.payroll.manage,
};

/** `settings.changed` is categorised by the key's scope (AUDIT.md §3), so payroll keys stay payroll-readable only. */
const CATEGORY: Record<SettingScope, AuditCategory> = {
  technical: 'technical',
  hr: 'business',
  payroll: 'payroll',
};

/** `settings.read` reads every scope; a `settings.<scope>.manage` holder reads the scopes they manage. */
function readableScopes(auth: AuthContext): SettingScope[] {
  if (auth.can(P.settings.read)) return [...settingScopeValues];
  return settingScopeValues.filter((s) => auth.can(MANAGE[s]));
}

async function load(db: Queryable, companyId: string) {
  const rows = await db.select().from(settings).where(eq(settings.companyId, companyId));
  return new Map(rows.map((r) => [r.key, r]));
}

async function groups(db: Queryable, auth: AuthContext, scopes: SettingScope[]): Promise<SettingsGroups> {
  const stored = await load(db, auth.companyId);
  const out: SettingsGroups = {};
  for (const scope of scopes) {
    out[scope] = SETTING_KEYS.filter((k) => SETTINGS[k].scope === scope).map((key): SettingDto => {
      const row = stored.get(key);
      return {
        key,
        scope,
        value: row ? row.value : SETTINGS[key].default,
        defaultValue: SETTINGS[key].default,
        version: row?.version ?? 0,
        updatedAt: row?.updatedAt.toISOString() ?? null,
        editable: auth.can(MANAGE[scope]),
      };
    });
  }
  return out;
}

export async function getSettings(deps: Deps, auth: AuthContext) {
  const scopes = readableScopes(auth);
  if (!scopes.length) throw forbidden();
  return groups(deps.db, auth, scopes);
}

/**
 * `PATCH /settings` (FR-SET-002): every key is validated by its catalogue schema and needs `settings.<scope>.manage`.
 * All changes commit together with their `settings_history` rows and `settings.changed` audits, or none do.
 */
export async function updateSettings(deps: Deps, auth: AuthContext, input: UpdateSettingsInput) {
  const scopes = readableScopes(auth);
  if (!scopes.length) throw forbidden();
  requireStrong(auth);

  const errors: FieldError[] = [];
  const parsed: { key: SettingKey; value: unknown; version: number }[] = [];
  for (const [key, change] of Object.entries(input.changes)) {
    if (!(SETTING_KEYS as string[]).includes(key)) {
      errors.push({ path: `/changes/${key}`, code: 'unknown_key', message: 'Unknown setting.' });
      continue;
    }
    const def = SETTINGS[key as SettingKey];
    if (!auth.can(MANAGE[def.scope])) throw forbidden();
    const result = def.schema.safeParse(change.value);
    if (!result.success) {
      errors.push({
        path: `/changes/${key}/value`,
        code: result.error.issues[0]?.code ?? 'invalid',
        message: result.error.issues[0]?.message ?? 'Invalid value.',
      });
      continue;
    }
    parsed.push({ key: key as SettingKey, value: result.data, version: change.version });
  }
  if (errors.length) throw validationFailed(errors);

  const now = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    for (const { key, value, version } of parsed) {
      const scope = SETTINGS[key].scope;
      const [row] = await tx
        .select()
        .from(settings)
        .where(and(eq(settings.companyId, auth.companyId), eq(settings.key, key)))
        .for('update');
      if ((row?.version ?? 0) !== version) throw versionConflict();
      if (row && JSON.stringify(row.value) === JSON.stringify(value)) continue;
      if (row) {
        await tx
          .update(settings)
          .set({
            value: jsonValue(value),
            version: sql`${settings.version} + 1`,
            updatedAt: now,
            updatedBy: auth.userId,
          })
          .where(and(eq(settings.companyId, auth.companyId), eq(settings.key, key)));
      } else {
        const inserted = await tx
          .insert(settings)
          .values({
            companyId: auth.companyId,
            key,
            scope,
            value: jsonValue(value),
            createdBy: auth.userId,
            updatedBy: auth.userId,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .returning({ key: settings.key });
        if (!inserted.length) throw versionConflict();
      }
      await tx.insert(settingsHistory).values({
        id: uuidv7(),
        companyId: auth.companyId,
        key,
        oldValue: row ? jsonValue(row.value) : null,
        newValue: jsonValue(value),
        changedBy: auth.userId,
        changedAt: now,
      });
      await recordAudit(tx, auth.actor, {
        action: 'settings.changed',
        category: CATEGORY[scope],
        entityType: 'setting',
        metadata: { key, scope, from: row ? row.value : null, to: value },
      });
    }
  });
  return groups(deps.db, auth, scopes);
}

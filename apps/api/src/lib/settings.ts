import { SETTINGS, type SettingKey, type SettingValue } from '@hrm/contracts';
import { type Queryable, schema } from '@hrm/db';
import { and, eq, inArray } from 'drizzle-orm';

/** Reads settings with catalogue defaults (CODING-STANDARDS §10). One query for any number of keys. */
export async function getSettings<K extends SettingKey>(
  db: Queryable,
  companyId: string,
  keys: readonly K[],
) {
  const rows = await db
    .select({ key: schema.settings.key, value: schema.settings.value })
    .from(schema.settings)
    .where(and(eq(schema.settings.companyId, companyId), inArray(schema.settings.key, [...keys])));
  const found = new Map(rows.map((r) => [r.key, r.value]));
  const out = {} as { [P in K]: SettingValue<P> };
  for (const k of keys) {
    const parsed = SETTINGS[k].schema.safeParse(found.get(k));
    out[k] = (parsed.success ? parsed.data : SETTINGS[k].default) as SettingValue<K>;
  }
  return out;
}

export async function getSetting<K extends SettingKey>(
  db: Queryable,
  companyId: string,
  key: K,
): Promise<SettingValue<K>> {
  return (await getSettings(db, companyId, [key]))[key];
}

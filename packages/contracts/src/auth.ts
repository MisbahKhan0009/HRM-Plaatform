import { z } from 'zod';
import { PERMISSIONS, ROLE_CODES } from './permissions';
import { ThemeSchema } from './primitives';

export const userStatusValues = ['invited', 'active', 'suspended', 'deactivated'] as const;
export const UserStatusSchema = z.enum(userStatusValues);
export type UserStatus = z.infer<typeof UserStatusSchema>;

export const LocaleSchema = z.enum(['en', 'bn']);
export type Locale = z.infer<typeof LocaleSchema>;

export const RoleCodeSchema = z.enum(ROLE_CODES);
export const PermissionSchema = z.enum(PERMISSIONS as [string, ...string[]]);

/** `GET /auth/me` (AUTH-IMPLEMENTATION §9, FR-AUTH-004). */
export const CurrentUserSchema = z.object({
  user: z.object({
    id: z.uuid(),
    email: z.string(),
    name: z.string(),
    status: UserStatusSchema,
    theme: ThemeSchema,
    locale: LocaleSchema,
  }),
  employee: z
    .object({
      id: z.uuid(),
      employeeCode: z.string(),
      name: z.string(),
      hasDirectReports: z.boolean(),
    })
    .nullable(),
  roles: z.array(RoleCodeSchema),
  permissions: z.array(PermissionSchema),
  session: z.object({
    authMethod: z.enum(['passkey', 'email_otp']).nullable(),
    strongAuth: z.boolean(),
    strongAuthAt: z.string().nullable(),
    mfaRequired: z.boolean(),
  }),
  enrolment: z.object({ hasPasskey: z.boolean(), hasTotp: z.boolean() }),
});
export type CurrentUser = z.infer<typeof CurrentUserSchema>;

export const UpdatePreferencesInputSchema = z
  .object({ theme: ThemeSchema.optional(), locale: LocaleSchema.optional() })
  .strict()
  .refine((v) => v.theme !== undefined || v.locale !== undefined, { message: 'Nothing to update' });
export type UpdatePreferencesInput = z.infer<typeof UpdatePreferencesInputSchema>;

export const StepUpTotpInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^(\d{6}|[A-Za-z0-9-]{10,11})$/, 'Enter a 6-digit code or a backup code'),
  })
  .strict();
export type StepUpTotpInput = z.infer<typeof StepUpTotpInputSchema>;

/** Invitation token from the accept link: 32 random bytes, base64url. */
export const InvitationTokenParamSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

export const InvitationInfoSchema = z.object({ maskedEmail: z.string(), companyName: z.string() });
export type InvitationInfo = z.infer<typeof InvitationInfoSchema>;

export const AcceptInvitationResultSchema = z.object({ email: z.string(), codeSent: z.literal(true) });

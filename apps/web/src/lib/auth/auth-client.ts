import { passkeyClient } from '@better-auth/passkey/client';
import { emailOTPClient, twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

/** Better Auth client for sign-in, passkeys and TOTP (AUTH-IMPLEMENTATION). The cookie is HttpOnly; no token is ever read. */
export const authClient = createAuthClient({
  baseURL: typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
  basePath: '/api/v1/auth',
  plugins: [emailOTPClient(), passkeyClient(), twoFactorClient()],
});

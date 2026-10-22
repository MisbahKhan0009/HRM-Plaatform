// Used only by `@better-auth/cli generate` to emit the Drizzle schema for the auth tables.
import { createAuth } from './src/create-auth';

export const auth = createAuth({
  db: {} as never,
  schema: {},
  secret: 'schema-generation-only-not-a-real-secret',
  baseURL: 'http://localhost:8787',
  sendSignInCode: async () => {},
  canSignIn: async () => true,
  onSignedIn: async () => {},
});

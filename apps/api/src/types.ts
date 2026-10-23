import type { AuthContext } from './lib/auth-context';
import type { Deps } from './lib/deps';

export type AppEnv = {
  Bindings: Env;
  Variables: { requestId: string; deps: Deps; auth: AuthContext };
};

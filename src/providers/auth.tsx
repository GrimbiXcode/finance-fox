import { createContext, useContext, type ReactNode } from 'react';
import { trpc } from '@/providers/trpc';

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'member';
  color: string;
  totpEnabled: boolean;
}

interface AuthContextValue {
  user: SessionUser | null | undefined; // undefined = lädt noch
  needsSetup: boolean | undefined;
  logout: () => void;
  refresh: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const setup = trpc.auth.setupStatus.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => utils.auth.me.invalidate(),
  });

  return (
    <AuthContext.Provider value={{
      user: me.data === undefined ? undefined : me.data,
      needsSetup: setup.data?.needsSetup,
      logout: () => logoutMutation.mutate(),
      refresh: () => { utils.auth.me.invalidate(); utils.auth.setupStatus.invalidate(); },
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth muss innerhalb von AuthProvider verwendet werden');
  return ctx;
}

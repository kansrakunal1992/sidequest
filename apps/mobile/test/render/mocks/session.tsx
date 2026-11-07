const g = globalThis as any;
export const useSession = () => ({
  sessionLoaded: true, session: { user: { id: 'me-0000', email: 'me@test.local' } }, profile: g.__profile ?? { state: 'active', onboardingComplete: true }, profileError: false,
  refreshProfile: async () => { (g.__calls ??= []).push({ kind: 'refreshProfile' }); }, signOut: async () => { (g.__calls ??= []).push({ kind: 'signOut' }); },
});

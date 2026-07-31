// Which Auth.js routes must have the OpenEMR OIDC provider built into the
// per-request NextAuth config (see app/(auth)/auth.ts). Kept pure — no
// server-only imports — so both auth.ts and unit tests can use it.
//
// The provider is added only on these routes so that ordinary auth() calls (the
// hot path in lib/openemr/api.ts) never pay for the cookie decode + DB read the
// per-user provider needs:
//   - /providers        the client signIn("openemr") checks the provider list
//                        here BEFORE starting the flow; omit it and signIn
//                        silently bails to the sign-in page instead of
//                        redirecting to OpenEMR.
//   - /signin/openemr    begins the OAuth authorize redirect.
//   - /callback/openemr  completes the authorization-code exchange.
export function needsOpenEmrProvider(pathname: string): boolean {
  return (
    pathname.endsWith("/providers") ||
    pathname.endsWith("/signin/openemr") ||
    pathname.endsWith("/callback/openemr")
  );
}

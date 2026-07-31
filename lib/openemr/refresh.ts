// OpenEMR refresh-token exchange, hardened for refresh-token rotation.
//
// OpenEMR (league/oauth2-server) revokes the old refresh token whenever it
// issues a new one. Most `auth()` calls happen in route handlers or RSCs,
// where NextAuth cannot write the rotated tokens back to the session cookie —
// so several requests can arrive holding the same, already-consumed refresh
// token. To keep those requests working (instead of burning a doomed second
// exchange against a revoked token), results are memoized by the *incoming*
// refresh token, and concurrent calls share a single in-flight request. The
// cookie eventually catches up via the client's periodic /api/auth/session
// refetch (see SessionProvider in app/layout.tsx), which runs the jwt callback
// in a context that can persist it.

export type OpenEmrTokens = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number; // epoch seconds
  idToken?: string;
  scope?: string;
  // The OpenEMR instance these tokens belong to, captured at link time so the
  // API helper and session know which instance to call without a DB lookup.
  // (The client secret is never stored here — it's re-resolved for refresh.)
  apiBase?: string;
  issuer?: string;
  // Set when the refresh token was rejected and the user must sign in via
  // OpenEMR again. Mutually exclusive with the token fields.
  error?: "reconnect_required";
};

// The subset of an OpenEMR config needed to exchange a refresh token. Passed in
// (rather than read from env) so per-user connections refresh against their own
// instance and client credentials.
export type RefreshConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
};

export type RefreshResult =
  // Exchange succeeded — replace the stored tokens.
  | { status: "refreshed"; tokens: OpenEmrTokens }
  // The token endpoint rejected the refresh token (revoked or expired). The
  // connection is dead; the caller should drop the tokens.
  | { status: "expired" }
  // Couldn't reach the token endpoint (OpenEMR down, TLS failure). Transient:
  // keep the stale tokens and retry on a later request.
  | { status: "unavailable" };

type CacheEntry = {
  result: Promise<RefreshResult>;
  // null while in flight; set on settle. Entries past this time are evicted
  // lazily on the next lookup.
  evictAt: number | null;
};

// Keyed by the refresh token that was *sent*, so stale-cookie callers hit the
// memoized rotation result. Module-level: one per server process, matching the
// lifetime of NODE-side session handling.
const refreshCache = new Map<string, CacheEntry>();

// How long to remember that a refresh token was rejected, so a burst of
// requests holding the same dead token doesn't hammer the endpoint.
const EXPIRED_RESULT_TTL_MS = 60_000;

function evictStaleEntries(now: number) {
  for (const [key, entry] of refreshCache) {
    if (entry.evictAt !== null && now > entry.evictAt) {
      refreshCache.delete(key);
    }
  }
}

async function exchangeRefreshToken(
  config: RefreshConfig,
  refreshToken: string
): Promise<RefreshResult> {
  let res: Response;
  try {
    res = await fetch(`${config.issuer}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: refreshToken,
      }),
    });
  } catch {
    return { status: "unavailable" };
  }

  if (!res.ok) {
    return { status: "expired" };
  }

  let data: {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
    id_token?: string;
  };
  try {
    data = await res.json();
  } catch {
    return { status: "unavailable" };
  }

  return {
    status: "refreshed",
    tokens: {
      accessToken: data.access_token,
      // OpenEMR rotates refresh tokens: prefer the new one, keep old as fallback.
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
      idToken: data.id_token,
      scope: data.scope,
    },
  };
}

/**
 * Exchange an OpenEMR refresh token for fresh tokens. Single-flight and
 * memoized per incoming refresh token (see module comment): successful
 * rotations are remembered until the new access token expires, rejections
 * briefly, and transient failures not at all.
 */
export function refreshOpenEmrTokens(
  config: RefreshConfig,
  refreshToken: string
): Promise<RefreshResult> {
  const now = Date.now();
  evictStaleEntries(now);

  const cached = refreshCache.get(refreshToken);
  if (cached) {
    return cached.result;
  }

  const entry: CacheEntry = {
    result: exchangeRefreshToken(config, refreshToken),
    evictAt: null,
  };
  refreshCache.set(refreshToken, entry);

  entry.result.then((result) => {
    switch (result.status) {
      case "refreshed":
        // Serve the memoized rotation to stale-cookie callers until the new
        // access token expires (cookie catches up long before, via polling).
        entry.evictAt = result.tokens.expiresAt
          ? result.tokens.expiresAt * 1000
          : Date.now() + EXPIRED_RESULT_TTL_MS;
        break;
      case "expired":
        entry.evictAt = Date.now() + EXPIRED_RESULT_TTL_MS;
        break;
      default:
        // Transient failure: forget immediately so the next call retries.
        refreshCache.delete(refreshToken);
    }
  });

  return entry.result;
}

// Test-only: reset module state between unit test cases.
export function clearOpenEmrRefreshCacheForTests() {
  refreshCache.clear();
}

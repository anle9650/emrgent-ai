// Pure URL derivation for OpenEMR — the endpoints we call, and the callback URL
// we're called back on. Deliberately free of `server-only` so the settings form
// (a client component) and unit tests can both use the same functions the
// server does, rather than keeping hand-synced copies of the rules.

/**
 * Derive the OIDC issuer and REST API base from an OpenEMR server root, using
 * the standard "default" site layout ({root}/oauth2/default and
 * {root}/apis/default). Path-preserving (appends rather than taking the origin)
 * so subpath-hosted installs like https://host/openemr work.
 */
export function deriveOpenEmrUrls(serverUrl: string): {
  issuer: string;
  apiBase: string;
} {
  const base = serverUrl.trim().replace(/\/+$/, "");
  return {
    issuer: `${base}/oauth2/default`,
    apiBase: `${base}/apis/default`,
  };
}

/** The Auth.js callback path for the OpenEMR provider, minus any base path. */
export const OPENEMR_CALLBACK_PATH = "/api/auth/callback/openemr";

/**
 * Build the absolute OpenEMR callback URL from request-derived parts.
 *
 * `host` and `proto` normally come from the incoming request headers
 * (`x-forwarded-*` behind Vercel's proxy); `origin` short-circuits both when an
 * explicit `AUTH_URL` is configured. Returns null when there's nothing to build
 * from, so callers can fall back to describing the path instead of printing a
 * half-formed URL.
 */
export function buildOpenEmrRedirectUri({
  origin,
  proto,
  host,
  basePath,
}: {
  origin?: string | null;
  proto?: string | null;
  host?: string | null;
  basePath?: string | null;
}): string | null {
  const root = resolveRoot({ origin, proto, host });
  if (!root) {
    return null;
  }

  // A base path is a prefix, not a segment of the callback path — strip any
  // trailing slash so we never emit a doubled separator.
  const prefix = (basePath ?? "").replace(/\/+$/, "");
  return `${root}${prefix}${OPENEMR_CALLBACK_PATH}`;
}

function resolveRoot({
  origin,
  proto,
  host,
}: {
  origin?: string | null;
  proto?: string | null;
  host?: string | null;
}): string | null {
  if (origin) {
    // AUTH_URL may carry a path (it points at the Auth.js mount, not the site
    // root) — take just the origin and let basePath supply the prefix.
    try {
      return new URL(origin).origin;
    } catch {
      return null;
    }
  }

  if (!host) {
    return null;
  }

  // x-forwarded-proto can be a comma-separated chain; the first hop is ours.
  const scheme = (proto ?? "https").split(",")[0].trim() || "https";
  return `${scheme}://${host}`;
}

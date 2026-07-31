import { compare } from "bcrypt-ts";
import NextAuth, {
  type DefaultSession,
  type NextAuthConfig,
  type Session,
} from "next-auth";
import type { DefaultJWT, JWT } from "next-auth/jwt";
import { getToken } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import { DUMMY_PASSWORD, isDevelopmentEnvironment } from "@/lib/constants";
import {
  createGuestUser,
  getOrCreateOAuthUser,
  getUser,
} from "@/lib/db/queries";
import { needsOpenEmrProvider } from "@/lib/openemr/auth-routes";
import {
  type OpenEmrRuntimeConfig,
  resolveOpenEmrConfig,
} from "@/lib/openemr/config";
import type { OpenEmrTokens } from "@/lib/openemr/refresh";
import { refreshOpenEmrTokens } from "@/lib/openemr/refresh";
import { authConfig } from "./auth.config";

export type UserType = "guest" | "regular";

// OpenEMR OAuth2 tokens captured at sign-in and kept in the (encrypted) JWT so
// the app can call the OpenEMR API on the user's behalf. Refreshed in the jwt
// callback when near expiry (see lib/openemr/refresh.ts).
export type { OpenEmrTokens } from "@/lib/openemr/refresh";

// Refresh this long before the access token expires. Must comfortably exceed
// the SessionProvider refetchInterval (app/layout.tsx) so the refresh reliably
// happens during a /api/auth/session request — the one context that persists
// the rotated tokens back to the session cookie.
const REFRESH_WINDOW_SECONDS = 5 * 60;

declare module "next-auth" {
  interface Session extends DefaultSession {
    // Exposed for server-side OpenEMR API calls (see lib/openemr/api.ts).
    openemr?: {
      accessToken?: string;
      expiresAt?: number;
      scope?: string;
      // The API base of the OpenEMR instance these tokens belong to, so
      // server-side calls target the right (per-user) instance.
      apiBase?: string;
      error?: "reconnect_required";
    };
    user: {
      id: string;
      type: UserType;
    } & DefaultSession["user"];
  }

  interface User {
    email?: string | null;
    id?: string;
    type: UserType;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    openemr?: OpenEmrTokens;
    type: UserType;
  }
}

// Whether the OPENEMR_* env vars provide a fallback connection. Per-user
// connections (lib/openemr/config.ts) override this; it's the "is OpenEMR
// configured at all out of the box" signal, used by the settings UI to decide
// whether Connect can proceed without the user entering their own config.
export const isOpenEmrConfigured = Boolean(
  process.env.OPENEMR_SERVER_URL &&
    process.env.OPENEMR_CLIENT_ID &&
    process.env.OPENEMR_CLIENT_SECRET
);

// OpenEMR as an OIDC provider, built from a resolved (per-user or env)
// connection config. `issuer` triggers discovery via
// {issuer}/.well-known/openid-configuration. The registered client must use
// client_secret_post and be enabled in OpenEMR before this works.
//
// This is only ever added on the OpenEMR sign-in/callback routes (see the
// functional config below), so an unconfigured connection just means the
// provider is absent rather than an Auth.js Configuration error.
function buildOpenEmrOidcProvider(cfg: OpenEmrRuntimeConfig) {
  return {
    id: "openemr",
    name: "OpenEMR",
    type: "oidc" as const,
    issuer: cfg.issuer,
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    authorization: {
      // Must stay a subset of the client's registered scope in OpenEMR
      // (oauth_clients.scope).
      params: { scope: cfg.scope },
    },
    client: { token_endpoint_auth_method: "client_secret_post" as const },
    // OpenEMR doesn't reliably echo a nonce; PKCE + state are sufficient.
    checks: ["pkce" as const, "state" as const],
    profile(profile: Record<string, unknown>) {
      return {
        id: profile.sub as string,
        email: (profile.email as string | undefined) ?? null,
        name: (profile.name as string | undefined) ?? null,
        type: "regular" as const,
      };
    },
  };
}

const credentialsProvider = Credentials({
  credentials: {
    email: { label: "Email", type: "email" },
    password: { label: "Password", type: "password" },
  },
  async authorize(credentials) {
    const email = String(credentials.email ?? "");
    const password = String(credentials.password ?? "");
    const users = await getUser(email);

    if (users.length === 0) {
      await compare(password, DUMMY_PASSWORD);
      return null;
    }

    const [user] = users;

    if (!user.password) {
      await compare(password, DUMMY_PASSWORD);
      return null;
    }

    const passwordsMatch = await compare(password, user.password);

    if (!passwordsMatch) {
      return null;
    }

    return { ...user, type: "regular" };
  },
});

const guestProvider = Credentials({
  id: "guest",
  credentials: {},
  async authorize() {
    const [guestUser] = await createGuestUser();
    return { ...guestUser, type: "guest" };
  },
});

async function jwtCallback({
  token,
  user,
  account,
  profile,
  trigger,
  session,
}: {
  token: JWT;
  user?: { id?: string; email?: string | null; type?: UserType };
  account?: {
    provider?: string;
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
    id_token?: string;
    scope?: string;
  } | null;
  profile?: Record<string, unknown>;
  trigger?: "signIn" | "signUp" | "update";
  session?: { disconnectOpenemr?: boolean } | null;
}): Promise<JWT> {
  // Client-initiated disconnect: drop the OpenEMR tokens from the JWT while
  // keeping the app session. Fired via useSession().update({ disconnectOpenemr:
  // true }) after the connection row is deleted.
  if (trigger === "update" && session?.disconnectOpenemr) {
    token.openemr = undefined;
    return token;
  }

  // OpenEMR account linking. The user is normally already signed in
  // (credentials), so keep their existing app identity — this is the "preserve
  // login identity" rule, which makes linking work even when the OpenEMR
  // account's email differs from the app login. Only mint/look up a user by
  // OpenEMR email when there's no prior identity.
  if (account?.provider === "openemr") {
    if (!token.id) {
      const email =
        (profile?.email as string | undefined) ??
        user?.email ??
        `openemr-${profile?.sub}`;
      const dbUser = await getOrCreateOAuthUser({
        email,
        name: (profile?.name as string | undefined) ?? null,
      });
      token.id = dbUser.id;
      token.type = "regular";
    }

    // Capture which instance these tokens belong to (non-secret), so the API
    // helper/session route the right OpenEMR without a DB lookup.
    const cfg = await resolveOpenEmrConfig(token.id);
    token.openemr = {
      accessToken: account.access_token,
      refreshToken: account.refresh_token,
      expiresAt: account.expires_at,
      idToken: account.id_token,
      scope: account.scope,
      apiBase: cfg?.apiBase,
      issuer: cfg?.issuer,
    };

    return token;
  }

  // Credentials / guest sign-in.
  if (user) {
    token.id = user.id as string;
    token.type = user.type as UserType;
  }

  // Refresh the OpenEMR access token shortly before it expires.
  if (
    token.openemr?.refreshToken &&
    token.openemr.expiresAt &&
    Math.floor(Date.now() / 1000) >
      token.openemr.expiresAt - REFRESH_WINDOW_SECONDS
  ) {
    // Re-resolve the connection so refresh hits the user's own issuer/client
    // credentials (never persisted in the JWT). If the connection is gone
    // (disconnected), treat it as a dead connection.
    const cfg = await resolveOpenEmrConfig(token.id);
    if (cfg) {
      const result = await refreshOpenEmrTokens(
        {
          issuer: cfg.issuer,
          clientId: cfg.clientId,
          clientSecret: cfg.clientSecret,
        },
        token.openemr.refreshToken
      );
      if (result.status === "refreshed") {
        token.openemr = {
          ...result.tokens,
          apiBase: token.openemr.apiBase ?? cfg.apiBase,
          issuer: token.openemr.issuer ?? cfg.issuer,
        };
      } else if (result.status === "expired") {
        // The refresh token was rejected — the connection is dead. Drop the
        // tokens so openemrFetch reports "not connected" instead of sending
        // a dead bearer token, and surface why via session.openemr.error.
        token.openemr = { error: "reconnect_required" };
      }
      // "unavailable" (OpenEMR unreachable): keep the stale tokens and let a
      // later request retry.
    } else {
      token.openemr = { error: "reconnect_required" };
    }
  }

  return token;
}

function sessionCallback({
  session,
  token,
}: {
  session: Session;
  token: JWT;
}): Session {
  if (session.user) {
    session.user.id = token.id;
    session.user.type = token.type;
  }

  if (token.openemr) {
    session.openemr = {
      accessToken: token.openemr.accessToken,
      expiresAt: token.openemr.expiresAt,
      scope: token.openemr.scope,
      apiBase: token.openemr.apiBase,
      error: token.openemr.error,
    };
  }

  return session;
}

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth(async (req) => {
  const providers: NextAuthConfig["providers"] = [
    credentialsProvider,
    guestProvider,
  ];

  // The per-user OpenEMR OIDC provider needs the linking user's config
  // (issuer/client credentials), which requires decoding the session cookie and
  // a DB read. Do that ONLY on the Auth.js routes that actually need the
  // provider present: the provider listing (client signIn("openemr") checks it
  // via /api/auth/providers before starting the flow), the sign-in start, and
  // the callback. This keeps ordinary auth() calls — the hot path in
  // lib/openemr/api.ts on every OpenEMR request — from ever hitting the DB here.
  // Do NOT call auth() here (re-entry); use getToken to read the userId directly
  // from the cookie.
  const path = req?.nextUrl?.pathname ?? "";
  if (req && needsOpenEmrProvider(path)) {
    const token = await getToken({
      req,
      secret: process.env.AUTH_SECRET,
      secureCookie: !isDevelopmentEnvironment,
    });
    const cfg = await resolveOpenEmrConfig(token?.id as string | undefined);
    if (cfg) {
      providers.push(buildOpenEmrOidcProvider(cfg));
    }
  }

  return {
    ...authConfig,
    providers,
    callbacks: {
      jwt: jwtCallback,
      session: sessionCallback,
    },
  } satisfies NextAuthConfig;
});

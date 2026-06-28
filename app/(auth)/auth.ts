import { compare } from "bcrypt-ts";
import NextAuth, { type DefaultSession } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import { DUMMY_PASSWORD } from "@/lib/constants";
import {
  createGuestUser,
  getOrCreateOAuthUser,
  getUser,
} from "@/lib/db/queries";
import { authConfig } from "./auth.config";

export type UserType = "guest" | "regular";

// OpenEMR OAuth2 tokens captured at sign-in and kept in the (encrypted) JWT so
// the app can call the OpenEMR API on the user's behalf. Refreshed in the jwt
// callback when near expiry.
export type OpenEmrTokens = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number; // epoch seconds
  idToken?: string;
  scope?: string;
};

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      type: UserType;
    } & DefaultSession["user"];
    // Exposed for server-side OpenEMR API calls (see lib/openemr/api.ts).
    openemr?: {
      accessToken?: string;
      expiresAt?: number;
      scope?: string;
    };
  }

  interface User {
    id?: string;
    email?: string | null;
    type: UserType;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    type: UserType;
    openemr?: OpenEmrTokens;
  }
}

// Exchange a refresh token for a fresh access token. Returns null on failure so
// the caller can fall back to the (now-stale) token and let the API 401.
async function refreshOpenEmrToken(
  refreshToken: string,
): Promise<OpenEmrTokens | null> {
  try {
    const res = await fetch(`${process.env.OPENEMR_ISSUER}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: process.env.OPENEMR_CLIENT_ID ?? "",
        client_secret: process.env.OPENEMR_CLIENT_SECRET ?? "",
        refresh_token: refreshToken,
      }),
    });

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope?: string;
      id_token?: string;
    };

    return {
      accessToken: data.access_token,
      // OpenEMR rotates refresh tokens: prefer the new one, keep old as fallback.
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
      idToken: data.id_token,
      scope: data.scope,
    };
  } catch {
    return null;
  }
}

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
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
    }),
    Credentials({
      id: "guest",
      credentials: {},
      async authorize() {
        const [guestUser] = await createGuestUser();
        return { ...guestUser, type: "guest" };
      },
    }),
    // OpenEMR as an OIDC provider. `issuer` triggers discovery via
    // {issuer}/.well-known/openid-configuration. The registered client must use
    // client_secret_post and be enabled in OpenEMR before this works.
    {
      id: "openemr",
      name: "OpenEMR",
      type: "oidc",
      issuer: process.env.OPENEMR_ISSUER,
      clientId: process.env.OPENEMR_CLIENT_ID,
      clientSecret: process.env.OPENEMR_CLIENT_SECRET,
      authorization: {
        params: {
          // Full standard-API CRUD scope. Prefer OPENEMR_SCOPE (.env) as the
          // source of truth; this fallback mirrors it so sign-in still works if
          // the env var is unset. Must stay a subset of the client's registered
          // scope in OpenEMR (oauth_clients.scope).
          scope:
            process.env.OPENEMR_SCOPE ??
            "openid fhirUser offline_access api:oemr user/allergy.read user/allergy.write user/appointment.read user/appointment.write user/dental_issue.read user/dental_issue.write user/document.read user/document.write user/drug.read user/employer.read user/encounter.read user/encounter.write user/facility.read user/facility.write user/immunization.read user/insurance.read user/insurance.write user/insurance_company.read user/insurance_company.write user/insurance_type.read user/list.read user/medical_problem.read user/medical_problem.write user/medication.read user/medication.write user/message.write user/patient.read user/patient.write user/practitioner.read user/practitioner.write user/prescription.read user/procedure.read user/product.read user/soap_note.read user/soap_note.write user/surgery.read user/surgery.write user/transaction.read user/transaction.write user/user.read user/version.read user/vital.read user/vital.write",
        },
      },
      client: { token_endpoint_auth_method: "client_secret_post" },
      // OpenEMR doesn't reliably echo a nonce; PKCE + state are sufficient here.
      checks: ["pkce", "state"],
      profile(profile) {
        return {
          id: profile.sub as string,
          email: (profile.email as string | undefined) ?? null,
          name: (profile.name as string | undefined) ?? null,
          type: "regular",
        };
      },
    },
  ],
  callbacks: {
    async jwt({ token, user, account, profile }) {
      // Initial OpenEMR sign-in: upsert a local user, capture tokens.
      if (account?.provider === "openemr") {
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
        token.openemr = {
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at,
          idToken: account.id_token,
          scope: account.scope,
        };

        return token;
      }

      // Credentials / guest sign-in.
      if (user) {
        token.id = user.id as string;
        token.type = user.type;
      }

      // Refresh the OpenEMR access token shortly before it expires.
      if (
        token.openemr?.refreshToken &&
        token.openemr.expiresAt &&
        Math.floor(Date.now() / 1000) > token.openemr.expiresAt - 60
      ) {
        const refreshed = await refreshOpenEmrToken(token.openemr.refreshToken);
        if (refreshed) {
          token.openemr = refreshed;
        }
      }

      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.type = token.type;
      }

      if (token.openemr) {
        session.openemr = {
          accessToken: token.openemr.accessToken,
          expiresAt: token.openemr.expiresAt,
          scope: token.openemr.scope,
        };
      }

      return session;
    },
  },
});

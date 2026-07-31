import type { NextAuthConfig } from "next-auth";

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const authConfig = {
  basePath: "/api/auth",
  trustHost: true,
  pages: {
    signIn: `${base}/login`,
    newUser: `${base}/`,
    // OpenEMR is the only OAuth provider, and its sign-in is an in-app linking
    // flow started from the settings page — so failures belong back there,
    // beside the fields that can fix them, not on a dead-end error screen.
    error: `${base}/settings/openemr`,
  },
  providers: [],
  callbacks: {},
} satisfies NextAuthConfig;

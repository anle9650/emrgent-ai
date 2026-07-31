import type { User } from "@/lib/db/schema";

/** The `User` columns that make up an app identity on the JWT. */
export type AppIdentityUser = Pick<
  User,
  "id" | "email" | "name" | "image" | "isAnonymous"
>;

export type AppIdentity = {
  id: string;
  type: "guest" | "regular";
  email: string;
  name: string | null;
  picture: string | null;
};

/**
 * The identity fields to write onto the JWT when linking an OpenEMR account
 * onto an existing EMRgent AI user (see the jwt callback in app/(auth)/auth.ts).
 *
 * Auth.js seeds a fresh token from the OpenEMR profile on sign-in, so every
 * field here is an *overwrite* — including nulls. Returning the whole shape
 * rather than the non-empty parts is deliberate: skipping a null would leave the
 * OpenEMR profile's value in place, which is the bug this exists to prevent.
 *
 * `null` means there is no such row — the caller must fall through to the email
 * upsert rather than key the session to an id no User row can satisfy.
 */
export function appIdentityFromUser(
  appUser: AppIdentityUser | null | undefined
): AppIdentity | null {
  if (!appUser) {
    return null;
  }

  return {
    id: appUser.id,
    // From the row, never asserted: a guest who links OpenEMR keeps an
    // anonymous account, and calling them "regular" would hand them regular
    // entitlements (app/(chat)/api/chat/route.ts) on an ephemeral identity.
    type: appUser.isAnonymous ? "guest" : "regular",
    email: appUser.email,
    name: appUser.name,
    picture: appUser.image,
  };
}

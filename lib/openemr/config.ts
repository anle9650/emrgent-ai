import "server-only";

import { getOpenEmrConnection } from "@/lib/db/queries";
import { decryptSecret } from "@/lib/openemr/crypto";
import { deriveOpenEmrUrls } from "@/lib/openemr/urls";

// The static configuration needed to talk to an OpenEMR instance: OIDC issuer,
// REST API base, and the OAuth2 client credentials. This is the single source
// of truth resolved "DB overrides env, env is fallback" — see
// resolveOpenEmrConfig. Tokens are NOT part of this; they live in the NextAuth
// JWT.
export type OpenEmrRuntimeConfig = {
  issuer: string;
  apiBase: string;
  clientId: string;
  clientSecret: string;
  scope: string;
};

export const DEFAULT_OPENEMR_API_BASE = "https://localhost:9300/apis/default";

export const DEFAULT_OPENEMR_SERVER_URL = "https://localhost:9300";

// Lives in the server-free lib/openemr/urls.ts so the settings form and unit
// tests can share it; re-exported here since this module is the config entry
// point everything server-side already imports.
export { deriveOpenEmrUrls } from "@/lib/openemr/urls";

// Full standard-API CRUD scope. Used when neither a per-user connection nor
// OPENEMR_SCOPE specifies one. Must stay a subset of the client's registered
// scope in OpenEMR (oauth_clients.scope).
export const DEFAULT_OPENEMR_SCOPE =
  "openid fhirUser offline_access api:oemr user/allergy.read user/allergy.write user/appointment.read user/appointment.write user/dental_issue.read user/dental_issue.write user/document.read user/document.write user/drug.read user/employer.read user/encounter.read user/encounter.write user/facility.read user/facility.write user/immunization.read user/insurance.read user/insurance.write user/insurance_company.read user/insurance_company.write user/insurance_type.read user/list.read user/medical_problem.read user/medical_problem.write user/medication.read user/medication.write user/message.write user/patient.read user/patient.write user/practitioner.read user/practitioner.write user/prescription.read user/prescription.write user/procedure.read user/product.read user/soap_note.read user/soap_note.write user/surgery.read user/surgery.write user/transaction.read user/transaction.write user/user.read user/version.read user/vital.read user/vital.write";

/**
 * Build an OpenEMR config from the OPENEMR_* env vars, or null when the three
 * required OIDC values (issuer, client id, client secret) aren't all set. This
 * is the fallback when a user has no per-user connection row.
 */
export function envOpenEmrConfig(): OpenEmrRuntimeConfig | null {
  const serverUrl = process.env.OPENEMR_SERVER_URL;
  const clientId = process.env.OPENEMR_CLIENT_ID;
  const clientSecret = process.env.OPENEMR_CLIENT_SECRET;

  if (!(serverUrl && clientId && clientSecret)) {
    return null;
  }

  const { issuer, apiBase } = deriveOpenEmrUrls(serverUrl);
  return {
    issuer,
    apiBase,
    clientId,
    clientSecret,
    scope: process.env.OPENEMR_SCOPE ?? DEFAULT_OPENEMR_SCOPE,
  };
}

/**
 * Resolve the OpenEMR config for a given user: their saved per-user connection
 * if present (client secret decrypted), otherwise the env-based config. Each
 * field falls back to env when the stored row somehow lacks it. Returns null
 * when neither a row nor env config is available (OpenEMR simply unconfigured).
 */
export async function resolveOpenEmrConfig(
  userId?: string | null
): Promise<OpenEmrRuntimeConfig | null> {
  const env = envOpenEmrConfig();

  if (!userId) {
    return env;
  }

  const row = await getOpenEmrConnection(userId);
  if (!row) {
    return env;
  }

  // The saved server URL is authoritative for the endpoints — derive both from
  // it rather than falling back to env issuer/apiBase.
  const { issuer, apiBase } = deriveOpenEmrUrls(row.serverUrl);
  return {
    issuer,
    apiBase,
    clientId: row.clientId || env?.clientId || "",
    clientSecret: row.clientSecretEncrypted
      ? decryptSecret(row.clientSecretEncrypted)
      : (env?.clientSecret ?? ""),
    scope: row.scope || env?.scope || DEFAULT_OPENEMR_SCOPE,
  };
}

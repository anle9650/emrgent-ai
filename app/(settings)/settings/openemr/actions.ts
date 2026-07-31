"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import {
  getOpenEmrConnection,
  upsertOpenEmrConnection,
} from "@/lib/db/queries";
import { encryptSecret } from "@/lib/openemr/crypto";
import { deriveOpenEmrUrls } from "@/lib/openemr/urls";

export type OpenEmrSettingsState = {
  status: "idle" | "success" | "failed" | "invalid_data" | "unauthorized";
  message?: string;
  // Field-keyed messages so the form can render errors against the input that
  // caused them instead of firing a toast that dismisses itself.
  errors?: Partial<Record<"serverUrl" | "clientId" | "clientSecret", string>>;
};

const serverUrlSchema = z
  .string()
  .min(1, "Enter your OpenEMR server address.")
  .url("Enter a full address, including https://.")
  .refine((value) => value.startsWith("https://"), {
    message: "OpenEMR must be reached over https://.",
  });

const connectionSchema = z.object({
  serverUrl: serverUrlSchema,
  clientId: z.string().min(1, "Enter the client ID from your OpenEMR client."),
  // Optional: a blank secret on edit means "keep the existing one".
  clientSecret: z.string().optional(),
});

export async function saveOpenEmrConnection(
  _: OpenEmrSettingsState,
  formData: FormData
): Promise<OpenEmrSettingsState> {
  const session = await auth();
  if (!session?.user?.id || session.user.type === "guest") {
    return { status: "unauthorized" };
  }

  try {
    const parsed = connectionSchema.parse({
      serverUrl: (formData.get("serverUrl") as string | null)?.trim() ?? "",
      clientId: (formData.get("clientId") as string | null)?.trim() ?? "",
      clientSecret: formData.get("clientSecret") ?? undefined,
    });

    // Resolve the client secret: use the newly-entered one, else keep the
    // stored one. Require a secret on first setup (nothing to keep).
    const existing = await getOpenEmrConnection(session.user.id);
    const enteredSecret = parsed.clientSecret?.trim();
    let clientSecretEncrypted: string;
    if (enteredSecret) {
      clientSecretEncrypted = encryptSecret(enteredSecret);
    } else if (existing?.clientSecretEncrypted) {
      clientSecretEncrypted = existing.clientSecretEncrypted;
    } else {
      return {
        status: "invalid_data",
        errors: {
          clientSecret: "Enter the client secret from your OpenEMR client.",
        },
      };
    }

    await upsertOpenEmrConnection({
      userId: session.user.id,
      serverUrl: parsed.serverUrl.replace(/\/+$/, ""),
      clientId: parsed.clientId,
      clientSecretEncrypted,
      // Scope isn't user-configurable. Storing null lets resolveOpenEmrConfig
      // fall through to OPENEMR_SCOPE, else DEFAULT_OPENEMR_SCOPE.
      scope: null,
    });

    revalidatePath("/settings/openemr");
    return { status: "success" };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const fieldErrors = error.flatten().fieldErrors;
      return {
        status: "invalid_data",
        errors: {
          serverUrl: fieldErrors.serverUrl?.[0],
          clientId: fieldErrors.clientId?.[0],
          clientSecret: fieldErrors.clientSecret?.[0],
        },
      };
    }
    return { status: "failed" };
  }
}

export type OpenEmrTestResult = {
  ok: boolean;
  message: string;
};

const DISCOVERY_TIMEOUT_MS = 5000;

/**
 * Check that a server URL actually resolves to an OpenEMR OIDC issuer, before
 * the user is redirected off-site to authorize. The discovery document is
 * unauthenticated, so this needs no credentials — it only answers "is anything
 * OpenEMR-shaped listening there?". Self-signed dev certs pass via the global
 * TLS setting in instrumentation.ts.
 */
export async function testOpenEmrServer(
  serverUrl: string
): Promise<OpenEmrTestResult> {
  const parsed = serverUrlSchema.safeParse(serverUrl.trim());
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }

  const { issuer } = deriveOpenEmrUrls(parsed.data);
  const discoveryUrl = `${issuer}/.well-known/openid-configuration`;

  try {
    const response = await fetch(discoveryUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });

    if (!response.ok) {
      return {
        ok: false,
        message: `The server answered ${response.status} at ${issuer}. Check the address and that the OpenEMR API is enabled.`,
      };
    }

    const doc = (await response.json()) as { authorization_endpoint?: string };
    if (!doc.authorization_endpoint) {
      return {
        ok: false,
        message: `Something answered at ${issuer}, but it isn't an OpenEMR OAuth2 endpoint.`,
      };
    }

    return { ok: true, message: `Reached OpenEMR at ${issuer}.` };
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return {
        ok: false,
        message: `No answer from ${issuer} within 5 seconds.`,
      };
    }
    return {
      ok: false,
      message: `Couldn't reach ${issuer}. Check the address, and that the server is running and reachable from here.`,
    };
  }
}

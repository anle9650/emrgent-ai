"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import {
  deleteOpenEmrConnection,
  getOpenEmrConnection,
  upsertOpenEmrConnection,
} from "@/lib/db/queries";
import { encryptSecret } from "@/lib/openemr/crypto";

export type OpenEmrSettingsState = {
  status: "idle" | "success" | "failed" | "invalid_data" | "unauthorized";
  message?: string;
};

const httpsUrl = z
  .string()
  .url()
  .refine((value) => value.startsWith("https://"), {
    message: "Must be an https:// URL",
  });

const connectionSchema = z.object({
  serverUrl: httpsUrl,
  clientId: z.string().min(1),
  // Optional: a blank secret on edit means "keep the existing one".
  clientSecret: z.string().optional(),
  scope: z.string().optional(),
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
      serverUrl: formData.get("serverUrl"),
      clientId: formData.get("clientId"),
      clientSecret: formData.get("clientSecret") ?? undefined,
      scope: (formData.get("scope") as string | null)?.trim() || undefined,
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
        message: "A client secret is required.",
      };
    }

    await upsertOpenEmrConnection({
      userId: session.user.id,
      serverUrl: parsed.serverUrl,
      clientId: parsed.clientId,
      clientSecretEncrypted,
      scope: parsed.scope ?? null,
    });

    revalidatePath("/settings/openemr");
    return { status: "success" };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: "invalid_data", message: error.issues[0]?.message };
    }
    return { status: "failed" };
  }
}

export async function disconnectOpenEmrConnection(): Promise<OpenEmrSettingsState> {
  const session = await auth();
  if (!session?.user?.id || session.user.type === "guest") {
    return { status: "unauthorized" };
  }

  try {
    // Forget the saved connection. The live OpenEMR tokens are cleared from the
    // JWT client-side via a session update (see the form's disconnect handler),
    // and any later token refresh would fail-closed to reconnect_required.
    await deleteOpenEmrConnection(session.user.id);
    revalidatePath("/settings/openemr");
    return { status: "success" };
  } catch {
    return { status: "failed" };
  }
}

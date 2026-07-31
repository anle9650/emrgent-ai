import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, isOpenEmrConfigured } from "@/app/(auth)/auth";
import { OpenEmrConnectionForm } from "@/components/settings/openemr-connection-form";
import { Button } from "@/components/ui/button";
import { getOpenEmrConnection } from "@/lib/db/queries";
import { DEFAULT_OPENEMR_SERVER_URL } from "@/lib/openemr/config";

export default async function OpenEmrSettingsPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  // Guests can't own a persistent connection (their identity is ephemeral) —
  // show an upsell instead of the form. The menu item stays visible for
  // discoverability.
  if (session.user.type === "guest") {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-16">
        <h1 className="font-bold font-display text-2xl tracking-[0.02em]">
          Connect your OpenEMR
        </h1>
        <p className="text-muted-foreground text-sm">
          Sign up for an account to connect EMRgent AI to your own OpenEMR
          instance. You&rsquo;re currently exploring as a guest with demo data.
        </p>
        <div>
          <Button asChild>
            <Link href="/register">Sign up to connect</Link>
          </Button>
        </div>
      </div>
    );
  }

  const connection = await getOpenEmrConnection(session.user.id);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-10">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-bold font-display text-2xl tracking-[0.02em]">
          OpenEMR connection
        </h1>
        <p className="text-muted-foreground text-sm">
          Point EMRgent AI at your own OpenEMR instance. Register an OAuth2
          client in OpenEMR (using <code>client_secret_post</code>) with the
          redirect URI ending in <code>/api/auth/callback/openemr</code>, then
          enter its details below and connect.
        </p>
      </div>

      <OpenEmrConnectionForm
        connected={Boolean(session.openemr?.accessToken)}
        defaults={{
          serverUrl:
            connection?.serverUrl ??
            process.env.OPENEMR_SERVER_URL ??
            DEFAULT_OPENEMR_SERVER_URL,
          clientId: connection?.clientId ?? process.env.OPENEMR_CLIENT_ID ?? "",
          scope: connection?.scope ?? process.env.OPENEMR_SCOPE ?? "",
        }}
        envFallbackConfigured={isOpenEmrConfigured}
        hasSecret={Boolean(connection?.clientSecretEncrypted)}
        needsReconnect={session.openemr?.error === "reconnect_required"}
      />
    </div>
  );
}

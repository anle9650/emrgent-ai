import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, isOpenEmrConfigured } from "@/app/(auth)/auth";
import {
  ConnectionPanel,
  ConnectionStep,
} from "@/components/settings/connection-panel";
import { OpenEmrConnectionForm } from "@/components/settings/openemr-connection-form";
import { SkipConnectionNotice } from "@/components/settings/skip-connection-notice";
import { Button } from "@/components/ui/button";
import { useOpenEmrDemo } from "@/lib/constants";
import { getOpenEmrConnection } from "@/lib/db/queries";
import {
  DEFAULT_OPENEMR_SCOPE,
  DEFAULT_OPENEMR_SERVER_URL,
} from "@/lib/openemr/config";
import { buildOpenEmrRedirectUri } from "@/lib/openemr/urls";
import { readViewerTimeZone } from "@/lib/openemr/viewer-time";

export default async function OpenEmrSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const scope = process.env.OPENEMR_SCOPE ?? DEFAULT_OPENEMR_SCOPE;
  const scopeCount = scope.trim().split(/\s+/).length;

  // Guests can't own a persistent connection (their identity is ephemeral) —
  // show what connecting involves plus an upsell, rather than a bare paragraph.
  if (session.user.type === "guest") {
    // Guests never hold an OpenEMR token, so the demo instance is whatever the
    // flag says.
    return (
      <PageFrame>
        <GuestPanel demoActive={useOpenEmrDemo} scopeCount={scopeCount} />
      </PageFrame>
    );
  }

  const redirectUri = await resolveRedirectUri();
  const [connection, { error }] = await Promise.all([
    getOpenEmrConnection(session.user.id),
    searchParams,
  ]);

  const connected = Boolean(session.openemr?.accessToken);

  return (
    <PageFrame>
      <OpenEmrConnectionForm
        connectError={describeAuthError(error)}
        connected={connected}
        connectedSummary={
          connected
            ? {
                host: hostOf(session.openemr?.apiBase) ?? "OpenEMR",
                expiresAt: await formatExpiry(session.openemr?.expiresAt),
              }
            : undefined
        }
        defaults={{
          serverUrl:
            connection?.serverUrl ??
            process.env.OPENEMR_SERVER_URL ??
            DEFAULT_OPENEMR_SERVER_URL,
          clientId: connection?.clientId ?? process.env.OPENEMR_CLIENT_ID ?? "",
        }}
        // The same gate openemrRequest uses to serve the demo instance.
        demoActive={useOpenEmrDemo && !connected}
        envFallbackConfigured={isOpenEmrConfigured}
        hasSecret={Boolean(connection?.clientSecretEncrypted)}
        needsReconnect={session.openemr?.error === "reconnect_required"}
        redirectUri={redirectUri}
        scope={scope}
        scopeCount={scopeCount}
      />
    </PageFrame>
  );
}

function PageFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-2xl px-2 py-10 md:px-0">
      {children}
    </div>
  );
}

// The guest view previews the procedure rather than presenting it: the copy
// fields and controls a signed-in user gets would all be inert here, so the
// steps carry a one-line description each. That also keeps the panel short
// enough to read without scrolling.
function GuestPanel({
  scopeCount,
  demoActive,
}: {
  scopeCount: number;
  demoActive: boolean;
}) {
  return (
    <ConnectionPanel
      description="Connecting your own OpenEMR takes three steps, and an account to save the setup against."
      lineState={demoActive ? "demo" : "off"}
      notice={<SkipConnectionNotice demoActive={demoActive} />}
      title="OpenEMR connection"
    >
      <ConnectionStep
        first
        hint={`Register an API client on your server, using the redirect URI and ${scopeCount} scopes shown here once you're signed in.`}
        numeral="I"
        state="blocked"
        title="Register a client in OpenEMR"
      />

      <ConnectionStep
        hint="A guest session is discarded when you leave, so saving a connection needs an account of your own."
        numeral="II"
        state="active"
        title="Enter the credentials"
      >
        <Button asChild>
          <Link href="/register?callbackUrl=/settings/openemr">
            Create an account
          </Link>
        </Button>
      </ConnectionStep>

      <ConnectionStep
        hint="Sign in to OpenEMR and grant EMRgent AI access."
        last
        numeral="III"
        state="blocked"
        title="Authorize"
      />
    </ConnectionPanel>
  );
}

/** The absolute callback URL Auth.js will use, for step I's copy field. */
async function resolveRedirectUri(): Promise<string> {
  const headerList = await headers();
  return (
    buildOpenEmrRedirectUri({
      origin: process.env.AUTH_URL,
      proto: headerList.get("x-forwarded-proto"),
      host: headerList.get("x-forwarded-host") ?? headerList.get("host"),
      basePath: process.env.NEXT_PUBLIC_BASE_PATH,
    }) ?? "/api/auth/callback/openemr"
  );
}

function hostOf(apiBase?: string): string | null {
  if (!apiBase) {
    return null;
  }
  try {
    return new URL(apiBase).host;
  } catch {
    return null;
  }
}

/** Token expiry in the viewer's timezone — the server's is UTC on Vercel. */
async function formatExpiry(expiresAt?: number): Promise<string | undefined> {
  if (!expiresAt) {
    return;
  }
  const timeZone = await readViewerTimeZone();
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(new Date(expiresAt * 1000));
  } catch {
    return;
  }
}

// Auth.js redirects failed OAuth flows to pages.error with a coded reason.
// Translate the ones a user can act on; anything else gets a generic line that
// still points at the likely cause.
const AUTH_ERROR_COPY: Record<string, string> = {
  OAuthCallbackError:
    "OpenEMR rejected the callback. Check that the redirect URI in step I is registered on your OpenEMR client, exactly as shown.",
  OAuthSignInError:
    "Couldn't start the OpenEMR sign-in. Check the server address and that the client ID matches.",
  Callback:
    "The sign-in came back with an error. Check the redirect URI and client credentials, then try again.",
  AccessDenied:
    "Access was denied at OpenEMR. Make sure the client is authorized for the scopes in step I.",
  Configuration:
    "The connection isn't configured. Save your credentials in step II, then authorize.",
  OAuthAccountNotLinked:
    "That OpenEMR account is already linked to a different EMRgent user.",
};

function describeAuthError(error?: string): string | undefined {
  if (!error) {
    return;
  }
  return (
    AUTH_ERROR_COPY[error] ??
    "OpenEMR sign-in didn't complete. Check the redirect URI and client credentials, then try again."
  );
}

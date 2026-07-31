"use client";

import { useRouter } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import { useActionState, useEffect, useState } from "react";
import {
  disconnectOpenEmrConnection,
  type OpenEmrSettingsState,
  saveOpenEmrConnection,
} from "@/app/(settings)/settings/openemr/actions";
import { SubmitButton } from "@/components/chat/submit-button";
import { toast } from "@/components/chat/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Defaults = {
  serverUrl: string;
  clientId: string;
  scope: string;
};

const inputClass =
  "h-10 rounded-lg border-border/50 bg-muted/50 text-sm transition-colors focus:border-foreground/20 focus:bg-muted";

// Mirror of lib/openemr/config.ts's deriveOpenEmrUrls, inlined so this client
// component doesn't import the server-only config module. Kept in sync with it.
function derivePreview(serverUrl: string): { issuer: string; apiBase: string } {
  const base = serverUrl.trim().replace(/\/+$/, "");
  return { issuer: `${base}/oauth2/default`, apiBase: `${base}/apis/default` };
}

export function OpenEmrConnectionForm({
  connected,
  needsReconnect,
  hasSecret,
  envFallbackConfigured,
  defaults,
}: {
  connected: boolean;
  needsReconnect: boolean;
  hasSecret: boolean;
  envFallbackConfigured: boolean;
  defaults: Defaults;
}) {
  const router = useRouter();
  const { update: updateSession } = useSession();
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [serverUrl, setServerUrl] = useState(defaults.serverUrl);
  const preview = derivePreview(serverUrl);

  const [state, formAction] = useActionState<OpenEmrSettingsState, FormData>(
    saveOpenEmrConnection,
    { status: "idle" }
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: router is a stable ref
  useEffect(() => {
    if (state.status === "success") {
      toast({ type: "success", description: "OpenEMR connection saved." });
      router.refresh();
    } else if (state.status === "invalid_data") {
      toast({
        type: "error",
        description: state.message ?? "Please check the connection details.",
      });
    } else if (state.status === "unauthorized") {
      toast({
        type: "error",
        description: "You must be signed in to a regular account.",
      });
    } else if (state.status === "failed") {
      toast({ type: "error", description: "Failed to save the connection." });
    }
  }, [state]);

  // Connecting needs a resolvable config: either a saved secret (this user's
  // row) or the env fallback.
  const canConnect = hasSecret || envFallbackConfigured;

  let secretHint = "The OAuth2 client secret. Stored encrypted.";
  if (hasSecret) {
    secretHint = "Leave blank to keep the saved secret.";
  } else if (envFallbackConfigured) {
    secretHint =
      "Leave blank to use the server-configured client secret, or enter your own.";
  }

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      const result = await disconnectOpenEmrConnection();
      if (result.status === "success") {
        // Drop the live tokens from the JWT, then reload the settings view.
        await updateSession({ disconnectOpenemr: true });
        toast({ type: "success", description: "Disconnected from OpenEMR." });
        router.refresh();
      } else {
        toast({ type: "error", description: "Failed to disconnect." });
      }
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <ConnectionStatus connected={connected} needsReconnect={needsReconnect} />

      <form action={formAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label
            className="font-normal text-muted-foreground"
            htmlFor="serverUrl"
          >
            OpenEMR server URL
          </Label>
          <Input
            autoComplete="off"
            className={inputClass}
            id="serverUrl"
            name="serverUrl"
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="https://your-openemr"
            type="url"
            value={serverUrl}
          />
          <dl className="flex flex-col gap-1 text-xs">
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground/70">Issuer</dt>
              <dd className="break-all font-mono text-muted-foreground">
                {preview.issuer}
              </dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground/70">API base</dt>
              <dd className="break-all font-mono text-muted-foreground">
                {preview.apiBase}
              </dd>
            </div>
          </dl>
        </div>
        <Field
          defaultValue={defaults.clientId}
          id="clientId"
          label="Client ID"
          placeholder="OAuth2 client ID"
          type="text"
        />
        <Field
          hint={secretHint}
          id="clientSecret"
          label="Client secret"
          placeholder={hasSecret ? "•••••••• saved" : "OAuth2 client secret"}
          type="password"
        />

        <div className="flex items-center gap-3 pt-1">
          <SubmitButton isSuccessful={false}>Save</SubmitButton>
          <Button
            disabled={!canConnect}
            onClick={() =>
              signIn("openemr", { callbackUrl: "/settings/openemr" })
            }
            type="button"
            variant="outline"
          >
            {connected ? "Reconnect" : "Connect to OpenEMR"}
          </Button>
          {(connected || hasSecret) && (
            <Button
              className="ml-auto text-muted-foreground"
              disabled={isDisconnecting}
              onClick={handleDisconnect}
              type="button"
              variant="ghost"
            >
              Disconnect
            </Button>
          )}
        </div>
        {!canConnect && (
          <p className="text-xs text-muted-foreground">
            Save your client secret first, then connect.
          </p>
        )}
      </form>
    </div>
  );
}

function ConnectionStatus({
  connected,
  needsReconnect,
}: {
  connected: boolean;
  needsReconnect: boolean;
}) {
  let tone = "text-muted-foreground";
  let dot = "bg-muted-foreground/50";
  let label = "Not connected";

  if (needsReconnect) {
    tone = "text-attention";
    dot = "bg-attention";
    label = "Reconnect required";
  } else if (connected) {
    tone = "text-positive";
    dot = "bg-positive";
    label = "Connected";
  }

  return (
    <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em]">
      <span className={`size-2 rounded-full ${dot}`} />
      <span className={tone}>{label}</span>
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  placeholder,
  type,
  defaultValue,
}: {
  id: string;
  label: string;
  hint?: string;
  placeholder?: string;
  type: string;
  defaultValue?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label className="font-normal text-muted-foreground" htmlFor={id}>
        {label}
      </Label>
      <Input
        autoComplete="off"
        className={inputClass}
        defaultValue={defaultValue}
        id={id}
        name={id}
        placeholder={placeholder}
        type={type}
      />
      {hint && <p className="text-xs text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

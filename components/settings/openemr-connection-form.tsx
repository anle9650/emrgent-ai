"use client";

import {
  CheckCircle2Icon,
  EyeIcon,
  EyeOffIcon,
  XCircleIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import {
  useActionState,
  useEffect,
  useId,
  useState,
  useTransition,
} from "react";
import {
  type OpenEmrSettingsState,
  type OpenEmrTestResult,
  saveOpenEmrConnection,
  testOpenEmrServer,
} from "@/app/(settings)/settings/openemr/actions";
import { SubmitButton } from "@/components/chat/submit-button";
import { toast } from "@/components/chat/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deriveOpenEmrUrls } from "@/lib/openemr/urls";
import { cn } from "@/lib/utils";
import { ConnectionPanel, ConnectionStep } from "./connection-panel";
import { CopyField } from "./copy-field";
import type { LineState } from "./line-status";

type Defaults = {
  serverUrl: string;
  clientId: string;
};

// Long-form configuration, not chat input: these fields deliberately depart
// from the app-wide pill input (rounded-4xl) for a squarer field that reads as
// a form to be filled in. Shared so the deviation is one named decision.
export const settingsInputClass =
  "h-10 rounded-lg border-border/50 bg-muted/50 text-sm transition-colors focus:border-foreground/20 focus:bg-muted";

export function OpenEmrConnectionForm({
  connected,
  needsReconnect,
  hasSecret,
  envFallbackConfigured,
  defaults,
  redirectUri,
  scope,
  scopeCount,
  connectError,
  connectedSummary,
}: {
  connected: boolean;
  needsReconnect: boolean;
  hasSecret: boolean;
  envFallbackConfigured: boolean;
  defaults: Defaults;
  redirectUri: string;
  scope: string;
  scopeCount: number;
  connectError?: string;
  connectedSummary?: { host: string; expiresAt?: string };
}) {
  const router = useRouter();
  const { update: updateSession } = useSession();
  const [isDisconnecting, startDisconnect] = useTransition();
  const [isTesting, startTest] = useTransition();
  const [serverUrl, setServerUrl] = useState(defaults.serverUrl);
  const [testResult, setTestResult] = useState<OpenEmrTestResult | null>(null);
  const [revealSecret, setRevealSecret] = useState(false);
  const preview = deriveOpenEmrUrls(serverUrl);

  const [state, formAction] = useActionState<OpenEmrSettingsState, FormData>(
    saveOpenEmrConnection,
    { status: "idle" }
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: router is a stable ref
  useEffect(() => {
    if (state.status === "success") {
      toast({ type: "success", description: "Credentials saved." });
      router.refresh();
    } else if (state.status === "unauthorized") {
      toast({
        type: "error",
        description: "Sign in to a regular account to save a connection.",
      });
    } else if (state.status === "failed") {
      toast({ type: "error", description: "Couldn't save the credentials." });
    }
    // invalid_data renders inline against the offending field instead.
  }, [state]);

  // Authorizing needs a resolvable config: either a saved secret (this user's
  // row) or the env fallback.
  const canConnect = hasSecret || envFallbackConfigured;

  const lineState: LineState = pickLineState(connected, needsReconnect);

  const handleTest = () => {
    startTest(async () => {
      setTestResult(await testOpenEmrServer(serverUrl));
    });
  };

  const handleDisconnect = () => {
    startDisconnect(async () => {
      // Drops the OpenEMR tokens from the JWT only. The saved credentials stay
      // put, so reconnecting is one click — no re-entering the client secret.
      await updateSession({ disconnectOpenemr: true });
      toast({ type: "success", description: "Disconnected." });
      router.refresh();
    });
  };

  return (
    <form action={formAction}>
      <ConnectionPanel
        description="Point EMRgent AI at your own OpenEMR instance."
        footer={
          connected && connectedSummary ? (
            <ConnectedFooter
              isDisconnecting={isDisconnecting}
              onDisconnect={handleDisconnect}
              scopeCount={scopeCount}
              summary={connectedSummary}
            />
          ) : null
        }
        lineState={lineState}
        title="OpenEMR connection"
      >
        <ConnectionStep
          first
          hint="In OpenEMR, go to Admin → System → API Clients and register a new client with these three values. Choose the client_secret_post authentication method."
          numeral="I"
          state={hasSecret ? "done" : "active"}
          title="Register a client in OpenEMR"
        >
          <div className="flex flex-col gap-3">
            <CopyField label="Redirect URI" value={redirectUri} />
            <CopyField
              label="Authentication method"
              value="client_secret_post"
            />
            <CopyField
              label="Scope"
              summary={`${scopeCount} scopes — copy to paste into OpenEMR`}
              value={scope}
            />
          </div>
        </ConnectionStep>

        <ConnectionStep
          hint="Copy the client ID and secret OpenEMR generated, along with the address of the server itself."
          numeral="II"
          state={hasSecret ? "done" : "active"}
          title="Enter the credentials"
        >
          <div className="flex flex-col gap-4">
            <ServerUrlField
              error={state.errors?.serverUrl}
              isTesting={isTesting}
              onChange={setServerUrl}
              onTest={handleTest}
              preview={preview}
              testResult={testResult}
              value={serverUrl}
            />

            <TextField
              defaultValue={defaults.clientId}
              error={state.errors?.clientId}
              id="clientId"
              label="Client ID"
              placeholder="OAuth2 client ID"
            />

            <SecretField
              envFallbackConfigured={envFallbackConfigured}
              error={state.errors?.clientSecret}
              hasSecret={hasSecret}
              onToggleReveal={() => setRevealSecret((r) => !r)}
              reveal={revealSecret}
            />

            <div className="pt-1">
              <SubmitButton isSuccessful={false}>Save credentials</SubmitButton>
            </div>
          </div>
        </ConnectionStep>

        <ConnectionStep
          hint={
            canConnect
              ? "Sign in to OpenEMR and grant EMRgent AI access. You'll come back here when it's done."
              : "Save your credentials first — authorizing needs a client secret to send."
          }
          last
          numeral="III"
          state={authorizeStepState(connected, canConnect)}
          title="Authorize"
        >
          <div className="flex flex-col gap-3">
            <div>
              <Button
                disabled={!canConnect}
                onClick={() =>
                  signIn("openemr", { callbackUrl: "/settings/openemr" })
                }
                type="button"
                // A blocked or already-done step shouldn't dress its control as
                // the page's primary action.
                variant={connected || !canConnect ? "outline" : "default"}
              >
                {connected ? "Reauthorize" : "Connect to OpenEMR"}
              </Button>
            </div>
            {connectError && (
              <p
                className="flex items-start gap-2 text-[13px] text-negative"
                role="alert"
              >
                <XCircleIcon className="mt-0.5 size-3.5 shrink-0" />
                {connectError}
              </p>
            )}
          </div>
        </ConnectionStep>
      </ConnectionPanel>
    </form>
  );
}

function pickLineState(connected: boolean, needsReconnect: boolean): LineState {
  if (needsReconnect) {
    return "dropped";
  }
  return connected ? "live" : "off";
}

function authorizeStepState(connected: boolean, canConnect: boolean) {
  if (connected) {
    return "done" as const;
  }
  return canConnect ? ("active" as const) : ("blocked" as const);
}

function ConnectedFooter({
  summary,
  scopeCount,
  onDisconnect,
  isDisconnecting,
}: {
  summary: { host: string; expiresAt?: string };
  scopeCount: number;
  onDisconnect: () => void;
  isDisconnecting: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[11px]">
        <div className="flex gap-2">
          <dt className="text-muted-foreground/60">Server</dt>
          <dd className="text-foreground/80">{summary.host}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground/60">Scopes</dt>
          <dd className="text-foreground/80">{scopeCount}</dd>
        </div>
        {summary.expiresAt && (
          <div className="flex gap-2">
            <dt className="text-muted-foreground/60">Token expires</dt>
            <dd className="text-foreground/80">{summary.expiresAt}</dd>
          </div>
        )}
      </dl>
      <Button
        className="text-muted-foreground"
        disabled={isDisconnecting}
        onClick={onDisconnect}
        size="sm"
        type="button"
        variant="ghost"
      >
        Disconnect
      </Button>
    </div>
  );
}

function ServerUrlField({
  value,
  onChange,
  onTest,
  isTesting,
  testResult,
  preview,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  onTest: () => void;
  isTesting: boolean;
  testResult: OpenEmrTestResult | null;
  preview: { issuer: string; apiBase: string };
  error?: string;
}) {
  const hintId = useId();
  const errorId = useId();

  return (
    <div className="flex flex-col gap-2">
      <Label className="font-normal text-muted-foreground" htmlFor="serverUrl">
        Server address
      </Label>
      <div className="flex items-center gap-2">
        <Input
          aria-describedby={error ? errorId : hintId}
          aria-invalid={Boolean(error) || undefined}
          autoComplete="off"
          className={cn(settingsInputClass, "flex-1")}
          id="serverUrl"
          name="serverUrl"
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://openemr.example.org"
          type="url"
          value={value}
        />
        <Button
          className="h-10 shrink-0"
          disabled={isTesting}
          onClick={onTest}
          type="button"
          variant="outline"
        >
          {isTesting ? "Testing…" : "Test"}
        </Button>
      </div>

      {error ? (
        <p className="text-[13px] text-negative" id={errorId} role="alert">
          {error}
        </p>
      ) : (
        <dl className="flex flex-col gap-1 text-xs" id={hintId}>
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
      )}

      {testResult && (
        <p
          className={cn(
            "flex items-start gap-2 text-[13px]",
            testResult.ok ? "text-positive" : "text-negative"
          )}
          role="status"
        >
          {testResult.ok ? (
            <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0" />
          ) : (
            <XCircleIcon className="mt-0.5 size-3.5 shrink-0" />
          )}
          {testResult.message}
        </p>
      )}
    </div>
  );
}

function TextField({
  id,
  label,
  placeholder,
  defaultValue,
  error,
}: {
  id: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  error?: string;
}) {
  const errorId = useId();

  return (
    <div className="flex flex-col gap-2">
      <Label className="font-normal text-muted-foreground" htmlFor={id}>
        {label}
      </Label>
      <Input
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error) || undefined}
        autoComplete="off"
        className={settingsInputClass}
        defaultValue={defaultValue}
        id={id}
        name={id}
        placeholder={placeholder}
        type="text"
      />
      {error && (
        <p className="text-[13px] text-negative" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function SecretField({
  hasSecret,
  envFallbackConfigured,
  reveal,
  onToggleReveal,
  error,
}: {
  hasSecret: boolean;
  envFallbackConfigured: boolean;
  reveal: boolean;
  onToggleReveal: () => void;
  error?: string;
}) {
  const hintId = useId();
  const errorId = useId();
  const hint = secretHint(hasSecret, envFallbackConfigured);

  return (
    <div className="flex flex-col gap-2">
      <Label
        className="font-normal text-muted-foreground"
        htmlFor="clientSecret"
      >
        Client secret
      </Label>
      <div className="relative">
        <Input
          aria-describedby={error ? errorId : hintId}
          aria-invalid={Boolean(error) || undefined}
          autoComplete="new-password"
          className={cn(settingsInputClass, "pr-10")}
          id="clientSecret"
          name="clientSecret"
          placeholder={hasSecret ? "•••••••• saved" : "OAuth2 client secret"}
          type={reveal ? "text" : "password"}
        />
        <Button
          aria-label={reveal ? "Hide client secret" : "Show client secret"}
          className="-translate-y-1/2 absolute top-1/2 right-1 text-muted-foreground"
          onClick={onToggleReveal}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          {reveal ? <EyeOffIcon /> : <EyeIcon />}
        </Button>
      </div>
      {error ? (
        <p className="text-[13px] text-negative" id={errorId} role="alert">
          {error}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground/70" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}

function secretHint(hasSecret: boolean, envFallbackConfigured: boolean) {
  if (hasSecret) {
    return "Saved and encrypted. Leave blank to keep it.";
  }
  if (envFallbackConfigured) {
    return "Leave blank to use the server-configured secret, or enter your own. Stored encrypted.";
  }
  return "Stored encrypted, and never sent back to your browser.";
}

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
import { useFormStatus } from "react-dom";
import {
  type OpenEmrSettingsState,
  type OpenEmrTestResult,
  saveOpenEmrConnection,
  testOpenEmrServer,
} from "@/app/(settings)/settings/openemr/actions";
import { LoaderIcon } from "@/components/chat/icons";
import { toast } from "@/components/chat/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deriveOpenEmrUrls } from "@/lib/openemr/urls";
import { cn } from "@/lib/utils";
import { ConnectedNotice, SkipConnectionNotice } from "./connection-notice";
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
  demoActive,
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
  /** The demo OpenEMR instance is serving this session — connecting is
   * optional, and the footer can offer a way into the app instead. */
  demoActive: boolean;
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
  // Held past the save so the button keeps its spinner through the redirect
  // to OpenEMR, which useFormStatus's pending no longer covers by then.
  const [isConnecting, setIsConnecting] = useState(false);
  // Any keystroke in the form means there are credentials worth saving. An
  // untouched form has nothing to write, so Connect can skip straight to the
  // authorize redirect (and must, when the config comes from env rather than a
  // saved row — there'd be no secret to satisfy the save with).
  const [edited, setEdited] = useState(false);
  const preview = deriveOpenEmrUrls(serverUrl);

  const [state, formAction] = useActionState<OpenEmrSettingsState, FormData>(
    saveOpenEmrConnection,
    { status: "idle" }
  );

  const startAuthorize = () => {
    setIsConnecting(true);
    // A failure here lands on this page via authConfig.pages.error, which
    // renders connectError; if it never leaves at all, give the button back.
    signIn("openemr", { callbackUrl: "/settings/openemr" }).catch(() =>
      setIsConnecting(false)
    );
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: router and startAuthorize are stable enough — this reacts to state only
  useEffect(() => {
    if (state.status === "success") {
      // Saving is a step on the way to authorizing, not a destination: the
      // credentials are only useful once OpenEMR has been asked for a token,
      // so the save hands straight off to the redirect. No toast — the page is
      // leaving.
      startAuthorize();
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
  // row) or the env fallback. Nothing saved and nothing typed means the submit
  // has to run, so the missing field is named inline.
  const canConnect = hasSecret || envFallbackConfigured;

  // Connect submits the form, so the credentials are saved before Auth.js
  // builds the per-user provider from them. An untouched form has nothing to
  // write, so it skips the save rather than round-tripping a no-op — and, with
  // no saved row, a save it couldn't satisfy.
  const handleConnect = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!edited && canConnect) {
      event.preventDefault();
      startAuthorize();
    }
  };

  const lineState: LineState = pickLineState(
    connected,
    needsReconnect,
    demoActive
  );

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
    <form action={formAction} onChange={() => setEdited(true)}>
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
        notice={
          connected ? (
            <ConnectedNotice />
          ) : (
            <SkipConnectionNotice demoActive={demoActive} />
          )
        }
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
          hint="Copy the client ID and secret OpenEMR generated, along with the address of the server itself. Connecting saves them, then sends you to OpenEMR to sign in — you'll come back here when it's done."
          last
          numeral="II"
          state={connected ? "done" : "active"}
          title="Connect"
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

            <div className="flex flex-col gap-3 pt-1">
              <div>
                <ConnectButton
                  connected={connected}
                  isConnecting={isConnecting}
                  onClick={handleConnect}
                />
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
          </div>
        </ConnectionStep>
      </ConnectionPanel>
    </form>
  );
}

// Reconnect-required outranks demo: it's the state the user can act on, even
// though the demo instance is what's actually answering in the meantime.
function pickLineState(
  connected: boolean,
  needsReconnect: boolean,
  demoActive: boolean
): LineState {
  if (needsReconnect) {
    return "dropped";
  }
  if (connected) {
    return "live";
  }
  return demoActive ? "demo" : "off";
}

/**
 * The step's one control, and the form's submit: it saves whatever's in the
 * fields and then leaves for OpenEMR. useFormStatus only covers the save half,
 * so `isConnecting` carries the spinner across the redirect.
 */
function ConnectButton({
  connected,
  isConnecting,
  onClick,
}: {
  connected: boolean;
  isConnecting: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const { pending } = useFormStatus();
  const busy = pending || isConnecting;

  return (
    <Button
      aria-disabled={busy}
      className="relative"
      disabled={busy}
      onClick={onClick}
      type={busy ? "button" : "submit"}
      // An already-live line shouldn't dress its control as the page's primary
      // action — by then the notice band above holds it.
      variant={connected ? "outline" : "default"}
    >
      {connected ? "Reauthorize" : "Connect to OpenEMR"}

      {busy && (
        <span className="absolute right-4 animate-spin">
          <LoaderIcon />
        </span>
      )}

      <output aria-live="polite" className="sr-only">
        {busy ? "Connecting to OpenEMR" : ""}
      </output>
    </Button>
  );
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

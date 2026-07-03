import { OpenTelemetry } from "@ai-sdk/otel";
import { registerTelemetry } from "ai";
import { registerOTel } from "@vercel/otel";

export function register() {
  registerOTel({ serviceName: "chatbot" });

  // AI SDK v7 no longer emits OpenTelemetry spans on its own. Register the
  // AI SDK OTel integration so `telemetry` on generateText/streamText flows
  // into the global tracer provider set up by registerOTel above.
  registerTelemetry(new OpenTelemetry());

  // DEV ONLY: OpenEMR serves its OAuth2/API over HTTPS with a self-signed
  // certificate on :9300. Node's fetch (used by Auth.js for discovery, token
  // exchange and userinfo, and by our server-side API helper) rejects that by
  // default. Disable TLS verification, scoped to the Node.js runtime and gated
  // behind an explicit opt-in env flag.
  //
  // NOTE: register() runs once at server startup and is NOT re-run on
  // hot-reload, so editing this file requires a full dev-server restart to take
  // effect. The warning below makes a stale/misconfigured server easy to spot.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const isDev = process.env.NODE_ENV !== "production";
    const allowSelfSigned = process.env.OPENEMR_ALLOW_SELF_SIGNED === "true";
    const issuer = process.env.OPENEMR_ISSUER;

    if (isDev && allowSelfSigned) {
      // Node's built-in fetch (used by Auth.js for discovery/token/userinfo and
      // by our server-side API helper) honors this for TLS verification. Set it
      // here so it applies before the first request; gated to dev + opt-in.
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    } else if (isDev && issuer?.startsWith("https://")) {
      // OpenEMR is configured over HTTPS in dev but self-signed handling is
      // off. If it uses a self-signed cert, sign-in will fail with the opaque
      // "[auth][error] TypeError: fetch failed" during OIDC discovery.
      console.warn(
        `[openemr] OPENEMR_ISSUER is set to ${issuer} but OPENEMR_ALLOW_SELF_SIGNED is not "true". ` +
          "If OpenEMR uses a self-signed cert, sign-in will fail with 'fetch failed' during OIDC discovery. " +
          "Set OPENEMR_ALLOW_SELF_SIGNED=true in .env.local (dev only) and restart the dev server."
      );
    }
  }
}

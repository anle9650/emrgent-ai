import { expect, test } from "@playwright/test";

// Scribe-mode flow against the mock layers: fixture appointments feed the
// picker, /api/transcribe returns the canned transcript, and the mock chat
// model plays the scribe script (getMedicalProblems -> createEncounter behind
// approval -> closing text). Names/phrases are literals mirroring
// lib/openemr/fixtures.ts — e2e tests cannot import app code.
const ELEANOR = "Eleanor Vance";

test.describe("Scribe mode", () => {
  test.beforeEach(async ({ page }) => {
    // The sidebar defaults to collapsed (no cookie); expand it so the
    // Chat | Scribe segmented toggle is visible.
    await page.context().addCookies([
      {
        name: "sidebar_state",
        value: "true",
        domain: "localhost",
        path: "/",
      },
    ]);
    await page.goto("/");
  });

  test("record an encounter and chart it through the agent", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Scribe" }).click();

    // A new session in scribe mode shows the patient/appointment picker,
    // listing only today's appointments from the fixtures.
    await expect(page.getByText("Start a scribe session")).toBeVisible();
    await expect(page.getByText("Hypertension Check")).toBeVisible({
      timeout: 15_000,
    });
    // Tomorrow's fixture appointment is filtered out.
    await expect(page.getByText("Follow-up Visit")).toHaveCount(0);

    await page
      .getByRole("button", { name: `Select appointment for ${ELEANOR}` })
      .click();

    // Recording panel for the selected patient.
    await expect(page.getByRole("heading", { name: ELEANOR })).toBeVisible();
    await expect(page.getByText("Ready to record")).toBeVisible();

    await page.getByRole("button", { name: "Start recording" }).click();
    await expect(page.getByText("Recording encounter")).toBeVisible({
      timeout: 15_000,
    });

    // Capture a moment of the fake device's tone, then finish.
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "Finish & draft note" }).click();

    // The kickoff lands in a fresh chat as a note card (patient name + the
    // "Scribe session" label), with the transcript collapsed — the raw prompt
    // text (uuid/pid/instruction) is hidden.
    const kickoff = page.locator("[data-role='user']").last();
    await expect(kickoff.getByText("Scribe session")).toBeVisible({
      timeout: 30_000,
    });
    await expect(kickoff.getByText(ELEANOR)).toBeVisible();
    await expect(page.getByText("uuid:")).toHaveCount(0);
    await page.getByRole("button", { name: "Encounter transcript" }).click();
    await expect(page.getByText("seasonal allergic rhinitis")).toBeVisible();

    // The kickoff's View chart button opens the patient overview artifact.
    await kickoff
      .getByRole("button", { name: `Open chart overview for ${ELEANOR}` })
      .click();
    const chart = page.getByTestId("artifact");
    await expect(chart).toBeVisible({ timeout: 10_000 });
    await expect(
      chart.getByRole("heading", { level: 2, name: ELEANOR })
    ).toBeVisible();
    await page.getByTestId("artifact-close-button").click();

    // Scribe script step 1: history read.
    const assistantMessage = page.locator("[data-role='assistant']").first();
    await expect(
      assistantMessage.getByText("getMedicalProblems", { exact: true })
    ).toBeVisible({ timeout: 30_000 });

    // Step 2: updateMedicalProblem AND createEncounter pause for approval in
    // the SAME step — the chat must not resume until both are answered
    // (a premature resend used to crash with AI_MissingToolResultsError).
    const allowButtons = page.getByRole("button", { name: "Allow" });
    await expect(allowButtons).toHaveCount(2, { timeout: 30_000 });
    await allowButtons.first().click();
    // Answering one approval must not resume the run on its own.
    await expect(page.getByText("Charted the encounter")).toHaveCount(0);
    await allowButtons.first().click();

    // Step 3: closing text after both approved writes execute.
    await expect(page.getByText("Charted the encounter")).toBeVisible({
      timeout: 30_000,
    });

    // Once the visit is charted, the overview chart opens on its own — even
    // though it was closed above, so this proves the auto-open (not a leftover).
    await expect(chart).toBeVisible({ timeout: 15_000 });
    await expect(
      chart.getByRole("heading", { level: 2, name: ELEANOR })
    ).toBeVisible();
    await page.getByTestId("artifact-close-button").click();

    // History is bifurcated by mode: the session is listed in scribe mode…
    const historyLinks = page.locator('a[href^="/chat/"]');
    await expect(historyLinks).toHaveCount(1, { timeout: 15_000 });

    // Scribe sessions get a deterministic title: patient name · visit date
    // (today, in the machine's local timezone, as "MMM d, yyyy").
    const today = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date());
    await expect(historyLinks.first()).toContainText(`${ELEANOR} · ${today}`);

    // …vanishes from the chat-mode list. The selected chat is bifurcated
    // too: chat mode had no chat open, so the toggle lands on new-session.
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    await expect(historyLinks).toHaveCount(0);
    await expect(page.getByText("Charted the encounter")).toHaveCount(0);

    // Toggling back restores scribe mode's selected chat, not a blank page.
    await page.getByRole("button", { name: "Scribe" }).click();
    await expect(historyLinks).toHaveCount(1);
    await expect(page.getByText("Charted the encounter")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("regular chats are hidden from scribe-mode history", async ({
    page,
  }) => {
    await page.getByTestId("multimodal-input").fill("hello there");
    await page.getByTestId("send-button").click();
    await expect(page.getByText("How can I help you today?")).toBeVisible({
      timeout: 30_000,
    });

    const historyLinks = page.locator('a[href^="/chat/"]');
    await expect(historyLinks).toHaveCount(1, { timeout: 15_000 });

    // Scribe mode has no selected chat yet, so it opens on the picker.
    await page.getByRole("button", { name: "Scribe" }).click();
    await expect(historyLinks).toHaveCount(0);
    await expect(page.getByText("Start a scribe session")).toBeVisible();

    // Toggling back restores chat mode's selected chat.
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    await expect(page.getByText("How can I help you today?")).toBeVisible();
    await expect(historyLinks).toHaveCount(1, { timeout: 15_000 });
  });

  test("recording continues across navigation", async ({ page }) => {
    await page.getByRole("button", { name: "Scribe" }).click();
    await expect(page.getByText("Hypertension Check")).toBeVisible({
      timeout: 15_000,
    });
    await page
      .getByRole("button", { name: `Select appointment for ${ELEANOR}` })
      .click();
    await page.getByRole("button", { name: "Start recording" }).click();
    await expect(page.getByText("Recording encounter")).toBeVisible({
      timeout: 15_000,
    });

    // While the panel itself is on screen, no floating indicator — but the
    // sidebar's New session slot shows the live status instead.
    const indicator = page.getByRole("button", {
      name: `Return to recording for ${ELEANOR}`,
    });
    await expect(indicator).toHaveCount(0);
    const sidebarStatus = page.getByTestId("sidebar-scribe-status");
    await expect(sidebarStatus).toBeVisible();
    await expect(sidebarStatus).toContainText(/Recording/i);
    await expect(page.getByText("New session")).toHaveCount(0);

    // Toggle to Chat mode — the panel unmounts, but the session lives in the
    // layout-level provider, so the recording keeps running and the floating
    // indicator appears. The sidebar status is scribe-mode-only, so chat
    // mode shows the plain New session button again.
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    await expect(indicator).toBeVisible();
    await expect(indicator).toContainText(/Recording/i);
    await expect(sidebarStatus).toHaveCount(0);
    await expect(page.getByText("New session")).toBeVisible();

    // Let the timer tick past zero, then return via the indicator.
    await page.waitForTimeout(2500);
    await indicator.click();

    // Back on the panel: still recording, timer never reset.
    await expect(page.getByRole("heading", { name: ELEANOR })).toBeVisible();
    await expect(page.getByText("Recording encounter")).toBeVisible();
    await expect(indicator).toHaveCount(0);
    await expect(page.getByText(/^(?!00:00$)\d+:\d{2}$/)).toBeVisible();

    // Finishing still produces the kickoff — the audio captured while the
    // panel was unmounted survived and transcribed.
    await page.getByRole("button", { name: "Finish & draft note" }).click();
    const kickoff = page.locator("[data-role='user']").last();
    await expect(kickoff.getByText("Scribe session")).toBeVisible({
      timeout: 30_000,
    });
    await expect(kickoff.getByText(ELEANOR)).toBeVisible();

    // The session ended, so the sidebar reverts to New session.
    await expect(sidebarStatus).toHaveCount(0);
    await expect(page.getByText("New session")).toBeVisible();
  });

  test("patient search offers selectable results", async ({ page }) => {
    await page.getByRole("button", { name: "Scribe" }).click();
    await expect(page.getByText("Start a scribe session")).toBeVisible();

    await page.getByPlaceholder(/Search by name/i).fill("Webb");
    await expect(page.getByText("1 patient found")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("button", { name: "Select Marcus Webb" }).click();
    await expect(
      page.getByRole("heading", { name: "Marcus Webb" })
    ).toBeVisible();
    await expect(page.getByText("Ready to record")).toBeVisible();

    // The recording panel's View chart button opens the overview artifact.
    await page
      .getByRole("button", { name: "Open chart overview for Marcus Webb" })
      .click();
    const artifact = page.getByTestId("artifact");
    await expect(artifact).toBeVisible({ timeout: 10_000 });
    await expect(
      artifact.getByRole("heading", { level: 2, name: "Marcus Webb" })
    ).toBeVisible();
    await expect(artifact.getByText("Asthma", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
  });
});

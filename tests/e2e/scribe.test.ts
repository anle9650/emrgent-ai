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
    await page.getByRole("button", { name: "Finish & transcribe" }).click();

    // The kickoff message lands in a fresh chat with the transcript collapsed.
    await expect(
      page.getByText(`Scribe session for patient ${ELEANOR}`)
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Encounter transcript" }).click();
    await expect(page.getByText("seasonal allergic rhinitis")).toBeVisible();

    // Scribe script step 1: history read.
    const assistantMessage = page.locator("[data-role='assistant']").first();
    await expect(
      assistantMessage.getByText("getMedicalProblems", { exact: true })
    ).toBeVisible({ timeout: 30_000 });

    // Step 2: createEncounter pauses for approval.
    await page
      .getByRole("button", { name: "Allow" })
      .click({ timeout: 30_000 });

    // Step 3: closing text after the approved write executes.
    await expect(page.getByText("Charted the encounter")).toBeVisible({
      timeout: 30_000,
    });

    // History is bifurcated by mode: the session is listed in scribe mode…
    const historyLinks = page.locator('a[href^="/chat/"]');
    await expect(historyLinks).toHaveCount(1, { timeout: 15_000 });

    // …vanishes from the chat-mode list…
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    await expect(historyLinks).toHaveCount(0);

    // …and reappears when toggling back.
    await page.getByRole("button", { name: "Scribe" }).click();
    await expect(historyLinks).toHaveCount(1);
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

    await page.getByRole("button", { name: "Scribe" }).click();
    await expect(historyLinks).toHaveCount(0);
  });

  test("patient search offers selectable results", async ({ page }) => {
    await page.getByRole("button", { name: "Scribe" }).click();
    await expect(page.getByText("Start a scribe session")).toBeVisible();

    await page.getByPlaceholder(/Last name/).fill("Webb");
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

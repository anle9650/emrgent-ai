import { expect, test } from "@playwright/test";

// Trigger phrases play scripted multi-step responses in the mock chat model
// (lib/ai/models.mock.ts): data tool call -> generateUI -> closing text. The
// names asserted below are literals mirroring lib/openemr/fixtures.ts — e2e
// tests cannot import app code, so keep them in sync by hand.
const ELEANOR = "Eleanor Vance";
const MARCUS = "Marcus Webb";

test.describe("Generative UI", () => {
  test("appointments: tool call, card, and click-through to patient overview", async ({
    page,
  }) => {
    await page.goto("/");

    await page
      .getByTestId("multimodal-input")
      .fill("Show me the upcoming appointments");
    await page.getByTestId("send-button").click();

    const assistantMessage = page.locator("[data-role='assistant']").first();
    await expect(assistantMessage).toBeVisible({ timeout: 30_000 });

    // Collapsed tool chrome for the data tool call.
    await expect(
      assistantMessage.getByText("getAppointments", { exact: true })
    ).toBeVisible({ timeout: 30_000 });

    // The AppointmentsCard rendered by generateUI shows fixture data.
    await expect(assistantMessage.getByText("Follow-up Visit")).toBeVisible({
      timeout: 30_000,
    });
    await expect(assistantMessage.getByText("Annual Physical")).toBeVisible();
    await expect(assistantMessage.getByText(ELEANOR).first()).toBeVisible();

    // Closing text step after the UI step.
    await expect(
      page.getByText("Here are the upcoming appointments")
    ).toBeVisible({ timeout: 30_000 });

    // The card bound to real data — no degraded source-resolution chip.
    await expect(page.getByText(/data unavailable/i)).toHaveCount(0);

    // Clicking an appointment row opens the patient-overview artifact.
    await page
      .getByRole("button", { name: `Open chart overview for ${ELEANOR}` })
      .first()
      .click();

    const artifact = page.getByTestId("artifact");
    await expect(artifact).toBeVisible({ timeout: 10_000 });
    await expect(
      artifact.getByRole("heading", { level: 2, name: ELEANOR })
    ).toBeVisible();

    // Chart sections aggregate through the fixture layer.
    await expect(artifact.getByText("Type 2 Diabetes Mellitus")).toBeVisible({
      timeout: 15_000,
    });
    await expect(artifact.getByText("Metformin 500mg")).toBeVisible();
    await expect(artifact.getByText("Penicillin")).toBeVisible();
  });

  test("patient search: tool call, card, and click-through to patient overview", async ({
    page,
  }) => {
    await page.goto("/");

    await page
      .getByTestId("multimodal-input")
      .fill("Search for patients in the system");
    await page.getByTestId("send-button").click();

    const assistantMessage = page.locator("[data-role='assistant']").first();
    await expect(assistantMessage).toBeVisible({ timeout: 30_000 });

    await expect(
      assistantMessage.getByText("searchPatients", { exact: true })
    ).toBeVisible({ timeout: 30_000 });

    // PatientsCard shows both fixture patients.
    await expect(assistantMessage.getByText(ELEANOR)).toBeVisible({
      timeout: 30_000,
    });
    await expect(assistantMessage.getByText(MARCUS)).toBeVisible();
    await expect(assistantMessage.getByText("2 patients found")).toBeVisible();

    await expect(page.getByText("I found these patients")).toBeVisible({
      timeout: 30_000,
    });

    // Clicking a patient card opens the same overview artifact.
    await page
      .getByRole("button", { name: `Open chart overview for ${MARCUS}` })
      .click();

    const artifact = page.getByTestId("artifact");
    await expect(artifact).toBeVisible({ timeout: 10_000 });
    await expect(
      artifact.getByRole("heading", { level: 2, name: MARCUS })
    ).toBeVisible();
    await expect(artifact.getByText("Asthma", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
  });
});

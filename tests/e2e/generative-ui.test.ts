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

  test("scheduling: interactive picker pauses the run, then books on confirm", async ({
    page,
  }) => {
    await page.goto("/");

    await page
      .getByTestId("multimodal-input")
      .fill("Schedule a follow-up for Eleanor");
    await page.getByTestId("send-button").click();

    const assistantMessage = page.locator("[data-role='assistant']").first();
    await expect(assistantMessage).toBeVisible({ timeout: 30_000 });

    // The picker is the selectAppointmentSlot client tool rendered inline — it
    // self-fetches slots (no data-tool chip precedes it) and pauses the run.
    await expect(assistantMessage.getByText("Open slots")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/data unavailable/i)).toHaveCount(0);

    // Slots are inert until picked: no confirmation slip yet.
    await expect(
      page.getByRole("button", { name: "Book appointment" })
    ).toHaveCount(0);

    // Each AM/PM ledger row leads with a sample of times; the rest are behind
    // a per-period disclosure. (Day-agnostic: which weekdays are open shifts
    // with the current date, so exercise the disclosures generically.)
    const disclosures = assistantMessage.getByRole("button", {
      name: /^Show all \d+ (AM|PM) times/,
    });
    // .count() is a one-shot read; wait for the ledger to actually paint
    // before sampling counts, or this flakes under a cold/contended server.
    await expect(disclosures.first()).toBeVisible({ timeout: 30_000 });
    const sampled = await assistantMessage
      .getByRole("button", { name: /^Select / })
      .count();
    // Clicking a disclosure expands that row and removes its button.
    while ((await disclosures.count()) > 0) {
      await disclosures.first().click();
    }
    expect(
      await assistantMessage.getByRole("button", { name: /^Select / }).count()
    ).toBeGreaterThan(sampled);

    const slot = assistantMessage
      .getByRole("button", { name: /^Select / })
      .first();
    const slotLabel = await slot.getAttribute("aria-label");
    await slot.click();

    // Picking only selects — the confirmation slip gates the booking.
    await expect(slot).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Appointment slip")).toBeVisible();

    // Cancel returns to the grid without booking.
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(
      page.getByRole("button", { name: "Book appointment" })
    ).toHaveCount(0);
    await expect(
      assistantMessage.getByText("Appointment booked", { exact: true })
    ).toHaveCount(0);

    // Confirming resolves the paused tool call; the run resumes and the
    // createAppointment server tool books the slot and renders the slip.
    await assistantMessage
      .getByRole("button", { name: slotLabel ?? /^Select / })
      .click();
    await page.getByRole("button", { name: "Book appointment" }).click();

    await expect(
      assistantMessage.getByText("Appointment booked", { exact: true })
    ).toBeVisible({ timeout: 15_000 });
    // The picked slot is echoed back in the booked slip.
    await expect(
      assistantMessage
        .getByText(slotLabel?.replace(/^Select /, "") ?? /at \d/)
        .first()
    ).toBeVisible();
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

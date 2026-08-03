import { expect, test } from "@playwright/test";

// Scribe-mode flow against the mock layers: fixture appointments feed the
// picker, /api/transcribe returns the canned transcript, the kickoff carries
// a prefetched prior-chart block (the overview route serves fixtures), and
// the mock chat model plays the scribe script (selectAppointmentSlot pauses
// the run on the inline picker -> createAppointment books the chosen slot ->
// FIVE staged approval waves, one clinical domain per step:
// updateMedicalProblem -> the medication wave (createMedication +
// createPrescription together) -> createEncounter -> sendReferral (the dermatology referral
// discussed in the visit) -> sendMessage (the visit-summary portal message) ->
// generateUI(ViewChartCard + ReferralCard) -> getNextAppointment (the
// next-patient prompt) -> closing text — scheduling first, while the patient is
// still in the room, and each wave's approval resolves before the next is
// proposed).
// Names/phrases are literals mirroring lib/openemr/fixtures.ts — e2e tests
// cannot import app code.
const ELEANOR = "Eleanor Vance";
// The other fixture patient roomed today (pc_apptstatus "<"), surfaced by
// getNextAppointment at the end of the run.
const MARCUS = "Marcus Webb";

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
    // The full charting flow is a long multi-step agent run (record → five
    // approvals → generateUI → next-patient prompt → closing text); it needs
    // more than the 30s default.
    test.setTimeout(60_000);
    await page.getByRole("button", { name: "Scribe", exact: true }).click();

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
    // text (uuid/pid/instruction) is hidden. The ordinary transcript holds one
    // visit, so the split check clears it and the review screen never shows —
    // asserted explicitly, since a mock detector that started splitting this
    // transcript would break every scribe test in a confusing way.
    await expect(page.getByText("More than one visit detected")).toHaveCount(0);
    const kickoff = page.locator("[data-role='user']").last();
    await expect(kickoff.getByText("Scribe session")).toBeVisible({
      timeout: 30_000,
    });
    await expect(kickoff.getByText(ELEANOR)).toBeVisible();
    // The handoff stamp — the opening half of the session arc.
    await expect(kickoff.getByText("Filed for charting")).toBeVisible();
    await expect(page.getByText("uuid:")).toHaveCount(0);
    // The prefetched prior-chart block travels in the message but must stay
    // invisible in the kickoff card.
    await expect(page.getByText("Prior chart")).toHaveCount(0);
    await page.getByRole("button", { name: "Encounter transcript" }).click();
    await expect(page.getByText("seasonal allergic rhinitis")).toBeVisible();

    // Scheduling streams FIRST and PAUSES the run: the transcript closes by
    // asking for a six-month recheck, so the agent calls selectAppointmentSlot,
    // which renders the inline picker and waits — the whole point is that the
    // patient, still in the room, picks a slot before the chart writes even
    // propose their approvals.
    await expect(page.getByText("Open slots")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/data unavailable/i)).toHaveCount(0);

    // The run is paused ON the picker: no write approvals have appeared yet.
    const allowButtons = page.getByRole("button", { name: "Approve" });
    await expect(allowButtons).toHaveCount(0);

    // A paused run flags the chat in the sidebar: the history refetch after
    // the stream pauses picks up the persisted input-available picker call,
    // and the history item shows the awaiting-input dot.
    const pendingDot = page.getByTestId("sidebar-item-pending");
    await expect(pendingDot).toBeVisible({ timeout: 15_000 });

    // Picking a slot and confirming resolves the paused tool call; the run
    // resumes, createAppointment books the slot, and the slip renders.
    await page
      .getByRole("button", { name: /^Select / })
      .first()
      .click();
    await expect(page.getByText("Appointment slip")).toBeVisible();
    await page.getByRole("button", { name: "Book appointment" }).click();
    await expect(
      page.getByText("Appointment booked", { exact: true })
    ).toBeVisible({ timeout: 15_000 });

    // Only NOW do the chart writes propose their approvals — as staged
    // waves, one write per step, each pausing the run until approved (no
    // context-read step — the kickoff's prior-chart block already carries
    // the chart). Wave 1: the problem update, ALONE — the later waves' cards
    // must not have been proposed yet.
    // The protocol timeline's step label and the collapsed tool header render
    // the same text, so this matches twice.
    await expect(
      page.getByText("Update problem", { exact: true }).first()
    ).toBeVisible({ timeout: 30_000 });
    await expect(allowButtons).toHaveCount(1);
    // The pending-input dot persists through the approval pauses — an
    // unanswered approval card is the other condition that flags the chat.
    await expect(pendingDot).toBeVisible({ timeout: 15_000 });
    // …and the charted check must NOT appear yet: the run is still pending, so
    // the "fully charted" flag stays false until every wave settles.
    await expect(page.getByTestId("sidebar-item-charted")).toHaveCount(0);
    await expect(page.getByText("Add medication", { exact: true })).toHaveCount(
      0
    );
    await expect(
      page.getByText("Create encounter", { exact: true })
    ).toHaveCount(0);
    await allowButtons.first().click();

    // Wave 2: the medication wave, only after wave 1 was approved — BOTH the
    // new medication and the refill prescription, proposed together in one
    // step, so two cards await approval at once. The protocol timeline's step
    // label and the collapsed tool header render the same text, so each
    // matches twice.
    await expect(
      page.getByText("Add medication", { exact: true }).first()
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText("Write prescription", { exact: true }).first()
    ).toBeVisible({ timeout: 30_000 });
    await expect(allowButtons).toHaveCount(2, { timeout: 15_000 });
    await expect(
      page.getByText("Create encounter", { exact: true })
    ).toHaveCount(0);
    await expect(page.getByText("Charted the encounter")).toHaveCount(0);
    await allowButtons.first().click();
    await expect(allowButtons).toHaveCount(1, { timeout: 15_000 });
    await allowButtons.first().click();

    // Wave 3: the encounter, ALONE. The protocol timeline's step label and the
    // collapsed tool header render the same text, so this matches twice.
    await expect(
      page.getByText("Create encounter", { exact: true }).first()
    ).toBeVisible({ timeout: 30_000 });
    await expect(allowButtons).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByText("File referral", { exact: true })).toHaveCount(
      0
    );
    await allowButtons.first().click();

    // Wave 4: the dermatology referral discussed in the visit, ALONE — filed
    // after the encounter, before the patient message (scribePrompt step 7).
    // The protocol timeline's step label and the collapsed tool header render
    // the same text, so this matches twice.
    await expect(
      page.getByText("File referral", { exact: true }).first()
    ).toBeVisible({ timeout: 30_000 });
    await expect(allowButtons).toHaveCount(1, { timeout: 15_000 });
    await expect(
      page.getByText("Send visit summary", { exact: true })
    ).toHaveCount(0);
    await allowButtons.first().click();

    // Wave 5: the visit-summary portal message, ALONE — approval-gated like the
    // chart writes, only proposed after the referral is filed. The protocol
    // timeline's step label and the collapsed tool header render the same
    // text, so this matches twice.
    await expect(
      page.getByText("Send visit summary", { exact: true }).first()
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect(allowButtons).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByText("Charted the encounter")).toHaveCount(0);
    await allowButtons.first().click();

    // Closing text after all approved writes execute.
    await expect(page.getByText("Charted the encounter")).toBeVisible({
      timeout: 30_000,
    });

    // Charting doesn't force-open the chart. The closing generateUI renders
    // a "View chart" card instead — stamped "Visit charted" with a receipt of
    // the session's writes (the mock script files one problem update, one new
    // medication, one prescription — both counted as medication writes — and
    // one encounter); clicking it opens the patient overview on demand.
    await expect(page.getByText("Visit charted")).toBeVisible();
    await expect(page.getByText("1 problem")).toBeVisible();
    await expect(page.getByText("2 medications")).toBeVisible();
    await expect(page.getByText("SOAP note filed")).toBeVisible();

    // The same closing surface also carries the filed-referral receipt — the
    // ReferralCard bound to the sendReferral write, alongside the chart link.
    await expect(page.getByText("Referral filed")).toBeVisible();

    // After charting, the run closes by surfacing the next roomed patient
    // (getNextAppointment) as a one-click start-scribe prompt — the fixtures
    // have Marcus Webb waiting In exam room today, and he's excluded from being
    // the current visit's patient (Eleanor), so his card renders here. The
    // card's own "Start scribe" affordance confirms it's the clickable prompt.
    const nextPatientCard = page.getByRole("button", {
      name: new RegExp(`Next patient.*${MARCUS}`, "i"),
    });
    await expect(nextPatientCard).toBeVisible();
    await expect(nextPatientCard.getByText("In exam room")).toBeVisible();
    await expect(nextPatientCard.getByText("Start scribe")).toBeVisible();

    const chart = page.getByTestId("artifact");
    await expect(chart).toBeHidden();
    await page
      .getByRole("button", { name: `View chart for ${ELEANOR}` })
      .click();
    await expect(chart).toBeVisible({ timeout: 10_000 });
    await expect(
      chart.getByRole("heading", { level: 2, name: ELEANOR })
    ).toBeVisible();
    // The header is fetched, not snapshot-fed: the appointment selection
    // carries no sex, but /api/patient/{uuid} supplies it.
    await expect(chart.getByText("Female", { exact: true })).toBeVisible();
    await page.getByTestId("artifact-close-button").click();

    // History is bifurcated by mode: the session is listed in scribe mode…
    const historyLinks = page.locator('a[href^="/chat/"]');
    await expect(historyLinks).toHaveCount(1, { timeout: 15_000 });

    // Scribe sessions get a deterministic title: patient name · appointment
    // title, since this session was started from today's fixture appointment.
    // (Only sessions with no appointment fall back to the visit date.)
    await expect(historyLinks.first()).toContainText(
      `${ELEANOR} · Hypertension Check`
    );

    // …vanishes from the chat-mode list. The selected chat is bifurcated
    // too: chat mode had no chat open, so the toggle lands on new-session.
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    await expect(historyLinks).toHaveCount(0);
    await expect(page.getByText("Charted the encounter")).toHaveCount(0);
    // The charted check is scribe-only — it never shows in chat-mode history.
    await expect(page.getByTestId("sidebar-item-charted")).toHaveCount(0);

    // Toggling back restores scribe mode's selected chat, not a blank page.
    await page.getByRole("button", { name: "Scribe", exact: true }).click();
    await expect(historyLinks).toHaveCount(1);
    await expect(page.getByText("Charted the encounter")).toBeVisible({
      timeout: 15_000,
    });

    // With every pause resolved and the run finished, the freshly refetched
    // history no longer flags the chat as awaiting input.
    await expect(pendingDot).toHaveCount(0, { timeout: 15_000 });
    // …and now flags it as fully charted: a settled successful createEncounter
    // with no pending tools left. This rides the same history refetch.
    await expect(page.getByTestId("sidebar-item-charted")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("charting refreshes the patient overview when it is already open", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.getByRole("button", { name: "Scribe", exact: true }).click();
    await expect(page.getByText("Hypertension Check")).toBeVisible({
      timeout: 15_000,
    });
    await page
      .getByRole("button", { name: `Select appointment for ${ELEANOR}` })
      .click();

    // Open the chart from the recording panel and leave it open through
    // recording and charting — the artifact lives at the layout level, so it
    // survives the hand-off from the recording panel to the chat.
    await page
      .getByRole("button", { name: `Open chart overview for ${ELEANOR}` })
      .click();
    const chart = page.getByTestId("artifact");
    await expect(chart).toBeVisible({ timeout: 10_000 });
    await expect(
      chart.getByRole("heading", { level: 2, name: ELEANOR })
    ).toBeVisible();

    await page.getByRole("button", { name: "Start recording" }).click();
    await expect(page.getByText("Recording encounter")).toBeVisible({
      timeout: 15_000,
    });
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "Finish & draft note" }).click();

    const kickoff = page.locator("[data-role='user']").last();
    await expect(kickoff.getByText("Scribe session")).toBeVisible({
      timeout: 30_000,
    });
    // Still open after the hand-off to the chat.
    await expect(chart).toBeVisible();

    // Count overview fetches from here on — charting the visit while the chart
    // is open must trigger a fresh revalidation (the refresh hook's mutate).
    let overviewFetches = 0;
    page.on("request", (request) => {
      if (request.url().includes("/api/openemr/patient-overview")) {
        overviewFetches += 1;
      }
    });

    // Scheduling pauses the run on the picker first; resolve it so the chart
    // writes propose their approvals.
    await expect(page.getByText("Open slots")).toBeVisible({ timeout: 30_000 });
    await page
      .getByRole("button", { name: /^Select / })
      .first()
      .click();
    await expect(page.getByText("Appointment slip")).toBeVisible();
    await page.getByRole("button", { name: "Book appointment" }).click();
    await expect(
      page.getByText("Appointment booked", { exact: true })
    ).toBeVisible({ timeout: 15_000 });

    // Five staged approval waves — approve every card as it arrives
    // (updateMedicalProblem → createMedication + createPrescription, the two
    // of them together in the medication wave → createEncounter →
    // sendReferral → sendMessage). getNextAppointment after them is a read
    // tool, so it needs no approval.
    const allowButtons = page.getByRole("button", { name: "Approve" });
    for (let approval = 0; approval < 6; approval += 1) {
      await expect(allowButtons.first()).toBeVisible({ timeout: 30_000 });
      await allowButtons.first().click();
    }
    await expect(page.getByText("Charted the encounter")).toBeVisible({
      timeout: 30_000,
    });

    // The open chart refetched after the encounter was written.
    await expect
      .poll(() => overviewFetches, { timeout: 10_000 })
      .toBeGreaterThan(0);
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
    await page.getByRole("button", { name: "Scribe", exact: true }).click();
    await expect(historyLinks).toHaveCount(0);
    await expect(page.getByText("Start a scribe session")).toBeVisible();

    // Toggling back restores chat mode's selected chat.
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    await expect(page.getByText("How can I help you today?")).toBeVisible();
    await expect(historyLinks).toHaveCount(1, { timeout: 15_000 });
  });

  test("recording continues across navigation", async ({ page }) => {
    await page.getByRole("button", { name: "Scribe", exact: true }).click();
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

  // --- Multi-encounter split -----------------------------------------------
  // The clinician forgets to stop recording and walks into the next room, so
  // one transcript holds two visits. Detection runs between transcription and
  // the kickoff, so the second patient's visit never reaches the first
  // patient's chart. Literals mirror lib/openemr/fixtures.ts and the canned
  // detector in lib/ai/models.mock.ts, which keys off these opening lines.
  const ELEANOR_VISIT =
    "Good morning. Blood pressure today is 132 over 84, pulse 76. " +
    "The headaches have improved since we started lisinopril, so continue 10 milligrams daily. " +
    "Diagnosing seasonal allergic rhinitis today; start loratadine 10 milligrams as needed. " +
    "Let's recheck the blood pressure in six months.";
  const MARCUS_VISIT =
    "Thanks for waiting, Marcus. How is the knee since the injection we did last month? " +
    "Still catching when you go down stairs? There is a little effusion but the ligaments " +
    "feel stable. I want you back in physical therapy twice a week for six weeks.";
  const SOFIA_VISIT =
    "Hello Sofia, nice to see you again. Your mother mentioned the cough has been keeping " +
    "you up at night. Let me listen to your chest and take a look at your throat before " +
    "we talk about starting an inhaler for this.";

  // Record with a transcript that spans several visits, stopping at the review
  // screen. Returns nothing — each test drives the review itself.
  async function recordSplitEncounter(
    page: import("@playwright/test").Page,
    transcript: string
  ) {
    await page.route("**/api/transcribe", (route) =>
      route.fulfill({ json: { text: transcript } })
    );
    await page.getByRole("button", { name: "Scribe", exact: true }).click();
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
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "Finish & draft note" }).click();
    await expect(page.getByText("More than one visit detected")).toBeVisible({
      timeout: 30_000,
    });
  }

  test("a two-visit recording is split and charted to both patients", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await recordSplitEncounter(page, `${ELEANOR_VISIT} ${MARCUS_VISIT}`);

    // One card per detected visit, the first pinned to the session's patient
    // and the second auto-matched from today's calendar (Marcus is roomed).
    const cards = page.getByTestId("split-encounter");
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toContainText("Visit 1 of 2");
    await expect(cards.first()).toContainText(ELEANOR);
    await expect(cards.first()).toContainText("This session");
    await expect(cards.nth(1)).toContainText("Visit 2 of 2");
    await expect(cards.nth(1)).toContainText(MARCUS);
    await expect(cards.nth(1)).toContainText("knee pain follow-up");

    // The excerpts are disjoint: the split actually cut the transcript.
    await cards.first().getByRole("button", { name: "Transcript" }).click();
    const firstExcerpt = cards.first().getByTestId("split-transcript");
    await expect(firstExcerpt).toContainText("seasonal allergic rhinitis");
    await expect(firstExcerpt).not.toContainText("Thanks for waiting, Marcus");

    await page.getByTestId("split-chart").click();

    // THE REGRESSION GUARD: the foreground kickoff is Eleanor's visit only —
    // Marcus's speech must not have travelled into her chart.
    const kickoff = page.locator("[data-role='user']").last();
    await expect(kickoff.getByText("Scribe session")).toBeVisible({
      timeout: 30_000,
    });
    await expect(kickoff.getByText(ELEANOR)).toBeVisible();
    await page.getByRole("button", { name: "Encounter transcript" }).click();
    await expect(page.getByText("seasonal allergic rhinitis")).toBeVisible();
    await expect(page.getByText("Thanks for waiting, Marcus")).toHaveCount(0);

    // The second visit is charting in its own session, listed in scribe
    // history with its own deterministic title.
    const historyLinks = page.locator('a[href^="/chat/"]');
    await expect(historyLinks).toHaveCount(2, { timeout: 20_000 });
    const marcusSession = historyLinks.filter({
      hasText: `${MARCUS} · Knee Pain Follow-up`,
    });
    await expect(marcusSession).toHaveCount(1);

    // Opening it shows Marcus's kickoff — proof the background chat persisted
    // server-side, not just in the tab that started it.
    await marcusSession.first().click();
    const marcusKickoff = page.locator("[data-role='user']").last();
    await expect(marcusKickoff.getByText("Scribe session")).toBeVisible({
      timeout: 30_000,
    });
    await expect(marcusKickoff.getByText(MARCUS)).toBeVisible();
    await page.getByRole("button", { name: "Encounter transcript" }).click();
    await expect(page.getByText("Thanks for waiting, Marcus")).toBeVisible();
  });

  test("a false split can be dismissed as one visit", async ({ page }) => {
    test.setTimeout(60_000);
    await recordSplitEncounter(page, `${ELEANOR_VISIT} ${MARCUS_VISIT}`);

    await page.getByTestId("split-not-split").click();

    // One session, carrying the whole recording.
    const kickoff = page.locator("[data-role='user']").last();
    await expect(kickoff.getByText("Scribe session")).toBeVisible({
      timeout: 30_000,
    });
    await expect(kickoff.getByText(ELEANOR)).toBeVisible();
    await page.getByRole("button", { name: "Encounter transcript" }).click();
    await expect(page.getByText("Thanks for waiting, Marcus")).toBeVisible();

    const historyLinks = page.locator('a[href^="/chat/"]');
    await expect(historyLinks).toHaveCount(1, { timeout: 20_000 });
  });

  test("an extra visit can be skipped instead of charted", async ({ page }) => {
    test.setTimeout(60_000);
    await recordSplitEncounter(page, `${ELEANOR_VISIT} ${MARCUS_VISIT}`);

    const chartButton = page.getByTestId("split-chart");
    await expect(chartButton).toContainText("Chart 2 visits");

    await page.getByTestId("split-toggle-skip").click();
    await expect(chartButton).toContainText("Chart this visit");
    // Dropping a transcript is unrecoverable, so it's stated rather than
    // hidden behind the button.
    await expect(page.getByText(/won't be charted/i)).toBeVisible();

    await chartButton.click();
    const kickoff = page.locator("[data-role='user']").last();
    await expect(kickoff.getByText("Scribe session")).toBeVisible({
      timeout: 30_000,
    });
    await expect(kickoff.getByText(ELEANOR)).toBeVisible();

    const historyLinks = page.locator('a[href^="/chat/"]');
    await expect(historyLinks).toHaveCount(1, { timeout: 20_000 });
    await expect(page.getByText(`${MARCUS} · Knee Pain`)).toHaveCount(0);
  });

  test("three visits render three cards, and an unmatched one blocks charting", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await recordSplitEncounter(
      page,
      `${ELEANOR_VISIT} ${MARCUS_VISIT} ${SOFIA_VISIT}`
    );

    const cards = page.getByTestId("split-encounter");
    await expect(cards).toHaveCount(3);
    await expect(cards.first()).toContainText("Visit 1 of 3");
    await expect(cards.nth(2)).toContainText("Visit 3 of 3");

    // Sofia isn't on today's calendar, so no patient is auto-suggested — and
    // an unassigned visit must block charting rather than guess a chart.
    await expect(cards.nth(2)).toContainText("Unassigned patient");
    const chartButton = page.getByTestId("split-chart");
    await expect(chartButton).toContainText("Chart 3 visits");
    await expect(chartButton).toBeDisabled();

    // No two visits share a chart: Marcus is suggested once, not twice.
    await expect(cards.filter({ hasText: MARCUS })).toHaveCount(1);

    // Skipping the unassignable visit unblocks the other two.
    await page.getByTestId("split-toggle-skip").nth(1).click();
    await expect(chartButton).toContainText("Chart 2 visits");
    await expect(chartButton).toBeEnabled();

    await chartButton.click();
    const historyLinks = page.locator('a[href^="/chat/"]');
    await expect(historyLinks).toHaveCount(2, { timeout: 20_000 });
  });

  test("patient search offers selectable results", async ({ page }) => {
    await page.getByRole("button", { name: "Scribe", exact: true }).click();
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

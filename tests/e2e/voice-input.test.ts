import { expect, type Page, test } from "@playwright/test";

// Playwright e2e files cannot import app code, so the mock is self-contained.
// The mock replaces the browser's SpeechRecognition; the live instance is
// stashed on window.__rec so tests can fire onresult/onend from page.evaluate.
function installMockSpeechRecognition(page: Page) {
  return page.addInitScript(() => {
    class MockSpeechRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        (window as unknown as { __rec: unknown }).__rec = this;
      }
      stop() {
        this.onend?.();
      }
      abort() {
        this.onend?.();
      }
    }
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition =
      MockSpeechRecognition;
    (
      window as unknown as { webkitSpeechRecognition: unknown }
    ).webkitSpeechRecognition = MockSpeechRecognition;
  });
}

function emitResult(page: Page, transcript: string, isFinal: boolean) {
  return page.evaluate(
    ([text, final]) => {
      const rec = (
        window as unknown as {
          __rec: { onresult: ((event: unknown) => void) | null };
        }
      ).__rec;
      const result = Object.assign([{ transcript: text }], { isFinal: final });
      rec.onresult?.({ resultIndex: 0, results: [result] });
    },
    [transcript, isFinal] as const
  );
}

test.describe("Voice Input", () => {
  test("mic button is visible when speech recognition is supported", async ({
    page,
  }) => {
    await installMockSpeechRecognition(page);
    await page.goto("/");
    await expect(page.getByTestId("voice-input-button")).toBeVisible();
  });

  test("mic button is hidden when speech recognition is unsupported", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      // Headless Chromium natively defines webkitSpeechRecognition.
      Object.defineProperty(window, "SpeechRecognition", { value: undefined });
      Object.defineProperty(window, "webkitSpeechRecognition", {
        value: undefined,
      });
    });
    await page.goto("/");
    await expect(page.getByTestId("multimodal-input")).toBeVisible();
    await expect(page.getByTestId("voice-input-button")).toHaveCount(0);
  });

  test("dictation appends to existing text, replacing interim with final", async ({
    page,
  }) => {
    await installMockSpeechRecognition(page);
    await page.goto("/");

    const input = page.getByTestId("multimodal-input");
    await input.fill("existing text");

    const micButton = page.getByTestId("voice-input-button");
    await micButton.click();
    await expect(micButton).toHaveAttribute("aria-pressed", "true");

    await emitResult(page, "hello", false);
    await expect(input).toHaveValue("existing text hello");

    await emitResult(page, "hello world", true);
    await expect(input).toHaveValue("existing text hello world");
  });

  test("tapping mic again stops listening and preserves input", async ({
    page,
  }) => {
    await installMockSpeechRecognition(page);
    await page.goto("/");

    const micButton = page.getByTestId("voice-input-button");
    await micButton.click();
    await expect(micButton).toHaveAttribute("aria-pressed", "true");

    await emitResult(page, "order labs", true);
    const input = page.getByTestId("multimodal-input");
    await expect(input).toHaveValue("order labs");

    await micButton.click();
    await expect(micButton).toHaveAttribute("aria-pressed", "false");
    await expect(input).toHaveValue("order labs");
  });
});

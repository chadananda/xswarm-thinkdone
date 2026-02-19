import { test, expect } from '@playwright/test';

/**
 * E2E onboarding conversation test.
 * Navigates to /meeting?reset, waits for dashboard to load,
 * then has a real conversation with the Claude-powered planning AI.
 * Tests the full onboarding flow: name, AI name, projects, people, work style, habits.
 */
test('onboarding conversation', async ({ page }) => {
  // Capture console for debugging
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('BROWSER ERROR:', msg.text());
  });
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  // --- Step 1: Load page with fresh DB ---
  console.log('Step 1: Loading /meeting?reset...');
  await page.goto('/meeting?reset');

  // Wait for the chat area to appear (means loading=false and DOM rendered)
  await page.waitForSelector('.chat-area', { timeout: 60_000 });
  console.log('Dashboard loaded!');

  // Verify initial state
  await expect(page.locator('.empty-chat')).toBeVisible();
  await expect(page.locator('.text-input')).toBeVisible();
  await page.screenshot({ path: 'test-results/e2e/01-loaded.png' });

  // Helper: send a message and wait for AI response
  async function sendAndWait(text, stepNum, stepName) {
    console.log(`Step ${stepNum}: Sending "${text}"...`);

    // Type and send
    const input = page.locator('.text-input');
    await input.fill(text);
    await input.press('Enter');

    // Wait for streaming to finish (send button re-enables)
    await expect(page.locator('.send-button')).not.toBeDisabled({ timeout: 120_000 });

    // Small pause for DOM to settle
    await page.waitForTimeout(500);

    // Get the last AI message
    const messages = page.locator('.message.ai .message-bubble');
    const count = await messages.count();
    const lastMsg = count > 0 ? await messages.nth(count - 1).textContent() : '';
    console.log(`AI response (${stepName}): ${lastMsg.slice(0, 200)}...`);

    await page.screenshot({ path: `test-results/e2e/${String(stepNum).padStart(2, '0')}-${stepName}.png` });
    return lastMsg;
  }

  // --- Step 2: Start conversation — AI should greet and ask for name ---
  const greeting = await sendAndWait('Good morning!', 2, 'greeting');
  expect(greeting.length).toBeGreaterThan(20);

  // --- Step 3: Give our name ---
  const nameResponse = await sendAndWait("My name is Chad. Nice to meet you!", 3, 'name');
  expect(nameResponse.toLowerCase()).toContain('chad');

  // --- Step 4: Name the AI ---
  const aiNameResponse = await sendAndWait("I'd like to call you Jafar.", 4, 'ai-name');
  // AI should acknowledge the name
  expect(aiNameResponse.toLowerCase()).toMatch(/jafar/);

  // --- Step 5: Projects ---
  const projectsResponse = await sendAndWait(
    "I'm working on ThinkDone, a productivity app. Also working on WholeReader, an education platform, and OceanLibrary, a digital library.",
    5, 'projects'
  );
  expect(projectsResponse.length).toBeGreaterThan(20);

  // --- Step 6: People ---
  const peopleResponse = await sendAndWait(
    "I work mostly solo but collaborate with a few contractors. My wife keeps me accountable on deadlines.",
    6, 'people'
  );
  expect(peopleResponse.length).toBeGreaterThan(20);

  // --- Step 7: Work style ---
  const workStyleResponse = await sendAndWait(
    "I like to plan first thing in the morning, around 8am. I'm a morning person and do my best deep work before noon.",
    7, 'work-style'
  );
  expect(workStyleResponse.length).toBeGreaterThan(20);

  // --- Step 8: Habits ---
  const habitsResponse = await sendAndWait(
    "I exercise daily in the morning, read for an hour at lunch, and do a weekly review on Sundays.",
    8, 'habits'
  );
  expect(habitsResponse.length).toBeGreaterThan(20);

  // --- Final screenshot ---
  await page.screenshot({ path: 'test-results/e2e/09-final.png', fullPage: true });
  console.log('Onboarding conversation complete!');

  // --- Verify the conversation had substance ---
  const allMessages = page.locator('.message');
  const totalMessages = await allMessages.count();
  console.log(`Total messages in conversation: ${totalMessages}`);
  expect(totalMessages).toBeGreaterThanOrEqual(10); // At least 5 user + 5 AI
});

Feature: ThinkDone Dashboard
  As a user of ThinkDone
  I want an interactive task list dashboard
  So that I can manage my daily priorities efficiently

  Background:
    Given the dashboard is loaded at "http://localhost:3456"

  # --- SSR & Page Load ---
  # Summary: Server-side rendering delivers tasks in initial HTML
  # Estimate: ~2h (SSR wiring + hydration testing)

  Scenario: Page loads with tasks pre-rendered (SSR)
    Given I have tasks in my today.md
    When the page loads
    Then tasks are visible immediately without a loading flash
    And the task HTML is present in the server response source

  Scenario: Page shows empty state when no tasks exist
    Given today.md does not exist
    When the page loads
    Then I see "Start a planning meeting to begin your day."

  # --- Branding & Header ---
  # Summary: Brand identity with icon, quotes, and live clock
  # Estimate: ~1h (layout + animations + clock interval)

  Scenario: Branding icon is visible in header
    When the page loads
    Then I see the favicon image next to the title
    And the icon spans the full toolbar height
    And clicking the icon opens "/" in a new window

  Scenario: Rotating motivational quotes
    When the page loads
    Then I see a motivational quote below the title
    And the quote rotates every 12 seconds with a fade transition

  Scenario: Live clock in header
    When the page loads
    Then I see the current date and time in the header
    And the clock updates every 30 seconds

  # --- Task CRUD ---
  # Summary: Create, check/uncheck, edit, and delete tasks with audio feedback
  # Estimate: ~3h (API mutations + animations + sound triggers)

  Scenario: Check a task plays applause sound
    Given I have an unchecked task "Write tests"
    When I check the checkbox for "Write tests"
    Then the task is marked as done with a strikethrough
    And the applause sound plays

  Scenario: Uncheck a task plays click sound
    Given I have a checked task "Write tests"
    When I uncheck the checkbox for "Write tests"
    Then the task is unmarked
    And the click sound plays

  Scenario: Add a new task with slide-in animation
    When I click the add button (FAB)
    And I type "New task" and press Enter
    Then the task appears at the top of the undone list
    And the task slides in with a smooth animation
    And the drop sound plays

  Scenario: Delete a task with poof animation
    Given I have a task "Delete me"
    When I open the menu for "Delete me" and click Delete
    Then the task explodes outward, blurs, and collapses to nothing
    And remaining tasks animate into the vacated space
    And the poof sound plays

  Scenario: Edit a task via double-click
    Given I have a task "Edit me"
    When I double-click on "Edit me"
    Then an edit card opens with the task text, time, and project fields
    When I change the text to "Edited task" and press Enter
    Then the task text updates to "Edited task"

  Scenario: Edit a task via hamburger menu
    Given I have a task "Edit me"
    When I hover over the task and click the menu button
    And I click "Edit"
    Then an edit card opens with the task text

  # --- Drag & Drop ---
  # Summary: Live drag reordering with visual displacement and persistence
  # Estimate: ~2h (drag events + array reorder + API persist)

  Scenario: Drag to reorder with live displacement
    Given I have tasks "First", "Second", "Third"
    When I drag "Third" over "First"
    Then the other tasks shift positions live during the drag
    And after dropping, the drop sound plays
    And the new order is persisted

  # --- Time Estimates & Day End ---
  # Summary: 8-hour workday cutoff line based on task time estimates
  # Estimate: ~1h (time parsing + cumulative sum + visual divider)

  Scenario: Day-end line appears at the 8-hour cutoff
    Given I have tasks totaling more than 8 hours of estimates
    When the page loads
    Then a "~8h day ends here" line appears between the last task that fits and the first that doesn't
    And tasks past the cutoff appear dimmed

  # --- Info Button ---
  # Summary: Per-task info popup showing project, estimate, and status
  # Estimate: ~1h (parse metadata + popup component)

  Scenario: Info button shows task details
    Given I have a task "Design mockups ~30m — thinkdone"
    When I hover over the task and click the (i) button
    Then I see a popup with:
      | Field    | Value      |
      | Project  | thinkdone  |
      | Estimate | 30m        |
      | Status   | To do      |
    And the raw task text is shown at the bottom

  # --- Text Rendering ---
  # Summary: Paper-colored text shadow prevents gridlines from touching text
  # Estimate: ~15m (CSS text-shadow tuning)

  Scenario: Text has background-colored shadow to clear gridlines
    When the page loads
    Then task text has a paper-colored text-shadow
    And the notebook gridlines do not touch the text

  # --- Scrollbar ---
  # Summary: Hidden scrollbar for clean notebook aesthetic
  # Estimate: ~10m (CSS scrollbar hiding)

  Scenario: No visible scrollbar on the page
    When the page has more tasks than fit the viewport
    Then the page scrolls normally
    But no scrollbar is visible

  # --- Reminders & Notifications ---
  # Summary: Pin upcoming/recurring reminders with on-screen notifications
  # Estimate: ~4h (reminder data model + scheduling + notification UI + recurring logic)

  Scenario: Pin a reminder to a task
    Given I have a task "Call dentist"
    When I open the edit card for "Call dentist"
    And I set a reminder for "tomorrow at 9am"
    Then the task shows a bell icon indicating a pending reminder
    And the reminder is persisted

  Scenario: On-screen notification fires at reminder time
    Given I have a task "Call dentist" with a reminder set for now
    When the reminder time arrives
    Then a notification toast appears on screen with the task text
    And a notification sound plays

  Scenario: Recurring reminder repeats on schedule
    Given I have a task "Weekly review" with a recurring reminder "every Monday at 10am"
    When the reminder fires
    Then a notification appears
    And the next occurrence is automatically scheduled for next Monday

  Scenario: Dismiss or snooze a notification
    Given a notification is showing for "Call dentist"
    When I click "Dismiss"
    Then the notification disappears
    When I click "Snooze 15m" instead
    Then the notification disappears and reappears in 15 minutes

  # --- Meeting Page ---
  # Summary: Planning meeting page personalized with user name
  # Estimate: ~30m (user context injection)

  Scenario: Meeting page shows user name
    When I open the meeting page
    Then the header reads "{userName}'s Planning Meeting"

  # --- Audio System ---
  # Summary: Howler.js sound effects for all user interactions
  # Estimate: ~1h (WAV files + howler integration + trigger points)

  Scenario: Sound effects are loaded from public/audio
    When the page loads
    Then the audio files (applause.wav, click.wav, drop.wav, poof.wav) are available
    And sounds play via howler.js on user interactions

  # --- User Context ---
  # Summary: Environment-based user config for workspace and personalization
  # Estimate: ~30m (env var module + integration)

  Scenario: User context is read from environment
    Given THINKDONE_USER_NAME is set to "Chad"
    When the page loads
    Then the user context is used for workspace path resolution
    And the meeting page shows "Chad's Planning Meeting"

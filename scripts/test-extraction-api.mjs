// Test the REAL Gemini extraction API call — what does it actually return?
import { config } from 'dotenv';
config();

const key = process.env.GEMINI_API_KEY;
if (!key) { console.log('No GEMINI_API_KEY'); process.exit(1); }

const transcript = "User: Good morning! I need to call the dentist, finish the report for Gilbert by Thursday, and buy groceries after work.\n\nAssistant: Great, let me help you plan that out. I'll note those down — calling the dentist, the report for Gilbert due Thursday, and groceries after work. What's the most urgent?";

const extractionPrompt = `You are a meeting extraction assistant. Analyze the following planning conversation and extract structured data.

## What to Extract
- **Tasks**: Any action item, to-do, or thing the user wants to do or was told to add. Include tasks mentioned explicitly ("add a task") AND tasks implied by discussion ("I need to call the dentist").
- **Decisions**: Conclusions reached during discussion.
- **Commitments**: Promises made to specific people.
- **Waiting for**: Things the user is waiting on from others.

## Output Format
Respond with ONLY a <meeting_state> XML block:
<meeting_state>
  <extractions>
    <task deadline="" project="">description</task>
    <decision project="">what was decided</decision>
    <commitment to="" deadline="">what was promised</commitment>
    <waiting_for from="" due="">what you're waiting for</waiting_for>
  </extractions>
  <agenda_updates>
    <resolve id="" resolution=""/>
    <defer id=""/>
    <add type="" priority="" content=""/>
  </agenda_updates>
  <next_item></next_item>
</meeting_state>

Only include tags for items actually found. If nothing to extract, return empty tags.`;

const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
const body = {
  systemInstruction: { parts: [{ text: extractionPrompt }] },
  contents: [{ role: 'user', parts: [{ text: transcript }] }],
  generationConfig: { temperature: 0, maxOutputTokens: 1024 },
};

console.log('Calling Gemini Flash extraction API...');
const response = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

if (!response.ok) {
  const errBody = await response.text();
  console.log(`API error ${response.status}:`, errBody.slice(0, 500));
  process.exit(1);
}

const data = await response.json();
const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
console.log('\n=== RAW GEMINI RESPONSE ===');
console.log(text);

// Now test parsing
const stateMatch = text.match(/<meeting_state>([\s\S]*?)<\/meeting_state>/);
console.log('\n=== PARSING ===');
console.log('Found <meeting_state>:', !!stateMatch);

if (stateMatch) {
  const xml = stateMatch[1];
  const taskRe = /<task\s+([^>]*)>([\s\S]*?)<\/task>/g;
  let m;
  const tasks = [];
  while ((m = taskRe.exec(xml))) {
    const attrStr = m[1];
    const deadlineMatch = attrStr.match(/deadline="([^"]*)"/);
    tasks.push({ text: m[2].trim(), deadline: deadlineMatch?.[1] || '' });
  }
  console.log(`Tasks found: ${tasks.length}`);
  for (const t of tasks) {
    console.log(`  - "${t.text}" (deadline="${t.deadline}")`);
    // Check if deadline is valid
    const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(t.deadline);
    console.log(`    deadline valid ISO: ${isValidDate}`);
  }
} else {
  console.log('NO XML FOUND — this is the bug');
  console.log('Response starts with:', text.slice(0, 100));
}

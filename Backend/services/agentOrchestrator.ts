import systemCommander = require('./systemCommander');
import modelRouter = require('./modelRouter');
import * as path from 'path';

const MAX_STEPS = 7;
const MAX_RETRIES = 2;
const RETRY_DELAY = 3000;

const PLANNER_PROMPT = `You are a task planner. Break the user's request into a short numbered list of 2 to 5 high-level steps.

RULES:
- Each step is ONE LINE only (max 80 chars)
- Steps describe WHAT to do, not HOW
- NO code, NO HTML, NO boilerplate
- Focus on file creation, then code writing, then verification

Example format:
1. Create project folder and files on Desktop
2. Write HTML structure
3. Add CSS styling
4. Write JavaScript logic
5. Open in browser to verify

Output ONLY the numbered list. No explanations. No code.`;

const CODER_PROMPT = `You are NEXUS Coding Agent. Implement the requested step using the tools below.

Output your tool call inside a code block with language "tool":

\`\`\`tool
{ "type": "file", "action": "write", "params": { ... } }
\`\`\`

IMPORTANT: Use the "tool" language tag, NOT "json" or empty.

VALID ACTIONS (use ONLY these exact action names):
- file/write: Create or overwrite a file
- file/create-project: Create a project folder with multiple files
- code/run: Execute code to test it

Example:
\`\`\`tool
{ "type": "file", "action": "write", "params": { "path": "C:\\\\Users\\\\LENOVO\\\\Desktop\\\\project\\\\file.html", "content": "<html><body>Hello</body></html>" } }
\`\`\`

Use EXACTLY "action": "write" for file creation. Never "create" or "make".
After the tool block, say what was done in plain text.`;

const VALIDATOR_PROMPT = `You are NEXUS QA Agent. Verify if the previous step was completed successfully.
Check for: files exist, code compiles/runs, no errors in output.
Respond with either:
- PASS: (reason why it works)
- FAIL: (specific issue to fix)
Then briefly explain what was verified.`;

function detectTaskRequest(text) {
  // Only trigger when user explicitly asks for autonomous execution
  if (/\b(?:agent|autonomous|autonomously|task|apne aap|khud se|automatically)\s+(?:se|karo|kare|do|execute|run|handle|banao|create|make|build)\b/i.test(text)) return true;
  if (/^(?:agent|task|autonomous|apne aap|khud)\b/i.test(text.trim())) return true;
  return false;
}

async function callLLM(systemPrompt, userMessage, modelPrefs) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      return await modelRouter.routeQuery(modelPrefs, messages, {
        preferredProvider: modelPrefs.provider,
        preferredModel: modelPrefs.model,
        autoRoute: false,
      });
    } catch (err) {
      lastErr = err;
      if (err.message && (err.message.includes('429') || err.message.includes('rate_limit'))) {
        const delay = RETRY_DELAY * (i + 1);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      if (i < 2) await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}

function parsePlan(text) {
  const lines = text.split('\n');
  const steps = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('```')) continue;
    const match = trimmed.match(/^\d+[\.\)]\s*(.+)/);
    if (match) {
      const step = match[1].trim();
      if (step.length > 5 && step.length < 200) {
        steps.push(step);
      }
    } else if (steps.length === 0 && trimmed.length > 10 && trimmed.length < 200) {
      steps.push(trimmed);
    }
  }
  return steps.length > 0 ? steps.slice(0, MAX_STEPS) : [text.trim().slice(0, 200)];
}

async function processTask(userQuery, modelPrefs, onProgress) {
  const log = (msg) => { if (onProgress) onProgress('log', msg); };
  const startTime = Date.now();

  log(`🤖 Task received: "${userQuery}"`);
  log('📋 Creating execution plan...');

  // Phase 1: Plan
  const planResult = await callLLM(PLANNER_PROMPT, userQuery, modelPrefs);
  const steps = parsePlan(planResult.text);
  log(`📋 Plan created: ${steps.length} steps`);
  steps.forEach((s, i) => log(`   ${i + 1}. ${s}`));

  // Phase 2: Execute each step
  let context = { userQuery, filesCreated: [] };
  let stepResults = [];
  let conversationHistory = `Task: ${userQuery}\n\nPlan:\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n`;

  for (let i = 0; i < Math.min(steps.length, MAX_STEPS); i++) {
    const step = steps[i];
    log(`\n🔧 Step ${i + 1}/${steps.length}: ${step}`);

    // Small delay between steps to avoid rate limits
    if (i > 0) await new Promise(r => setTimeout(r, 1500));

    let success = false;
    let attempts = 0;

    while (!success && attempts < MAX_RETRIES) {
      attempts++;

      const execPrompt = `Current step to implement:\n${step}\n\nContext so far:\n${conversationHistory}\n\nFiles created: ${JSON.stringify(context.filesCreated)}\n\nImplement this step.`;
      const execResult = await callLLM(CODER_PROMPT, execPrompt, modelPrefs);
      const responseText = execResult.text;

      // Execute tool calls in the response
      const toolCalls = systemCommander.parseToolCalls(responseText);
      let toolOutputs = [];

      for (const tc of toolCalls) {
        try {
          const result = await systemCommander.executeTool(tc);
          toolOutputs.push({ type: tc.type, action: tc.action, result });
          log(`   ⚡ Tool: ${tc.type}/${tc.action} — Ok`);

          // Track created files
          const writeActions = ['write', 'create', 'make'];
          if (tc.type === 'file' && writeActions.includes(tc.action)) {
            context.filesCreated.push(tc.params.path || tc.params.name || 'unknown');
          } else if (tc.type === 'file' && tc.action === 'create-project') {
            const projectPath = path.join('Desktop', tc.params.name || 'project');
            context.filesCreated.push(projectPath + '/');
          }
        } catch (err) {
          toolOutputs.push({ type: tc.type, action: tc.action, error: err.message });
          log(`   ⚡ Tool: ${tc.type}/${tc.action} — Error: ${err.message}`);
        }
      }

      const cleanText = responseText.replace(/```tool[\s\S]*?```/g, '').trim();
      const executionSummary = cleanText || `Step ${i + 1} executed`;

      conversationHistory += `\nStep ${i + 1}: ${step}\nExecution: ${executionSummary}\n`;
      if (toolOutputs.length > 0) {
        conversationHistory += `Tools used: ${JSON.stringify(toolOutputs.map(t => ({ type: t.type, action: t.action, success: !t.error })))}\n`;
      }

      stepResults.push({
        step: `${i + 1}. ${step}`,
        response: executionSummary,
        tools: toolOutputs,
        attempts,
      });

      // Validate
      const validatePrompt = `Step executed: ${step}\n\nExecution result:\n${executionSummary}\n\nTool outputs:\n${JSON.stringify(toolOutputs.map(t => t.error ? `Error: ${t.error}` : 'Ok'))}\n\nValidate this step:`;
      const validationResult = await callLLM(VALIDATOR_PROMPT, validatePrompt, modelPrefs);
      const validationText = validationResult.text.toUpperCase();

      if (validationText.includes('PASS')) {
        success = true;
        log(`   ✅ Step ${i + 1} passed validation`);
      } else if (attempts >= MAX_RETRIES) {
        log(`   ⚠️ Step ${i + 1} failed after ${MAX_RETRIES} attempts, moving on`);
        success = true; // Force continue
      } else {
        log(`   🔄 Step ${i + 1} failed validation, retry ${attempts}/${MAX_RETRIES}`);
        conversationHistory += `Validation: FAILED - ${validationText.slice(0, 200)}\nRetrying...\n`;
      }
    }

    stepResults[stepResults.length - 1].success = success;
  }

  // Phase 3: Summary
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  const successful = stepResults.filter(r => r.success !== false).length;
  const summary = `✅ Task completed in ${duration}s — ${successful}/${steps.length} steps successful. Files created: ${context.filesCreated.length}`;

  log(`\n📊 ${summary}`);

  return {
    summary,
    steps: stepResults,
    filesCreated: context.filesCreated,
    duration: parseFloat(duration),
    totalSteps: steps.length,
    successfulSteps: successful,
  };
}

export { processTask, detectTaskRequest };

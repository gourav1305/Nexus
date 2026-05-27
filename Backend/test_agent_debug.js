const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const modelRouter = require('./services/modelRouter');
const systemCommander = require('./services/systemCommander');

const prefs = { provider: 'groq', model: 'llama-3.3-70b-versatile', autoRoute: false };

async function test() {
  const coderPrompt = `You are NEXUS Coding Agent. Implement the requested step using the tools below.

VALID ACTIONS (use ONLY these exact action names):
- file/write: Create or overwrite a file
  OUTPUT FORMAT:
\`\`\`tool
{ "type": "file", "action": "write", "params": { "path": "C:\\Users\\LENOVO\\Desktop\\test.html", "content": "<html>...</html>" } }
\`\`\`

IMPORTANT: You MUST output the \`\`\`tool block with JSON to perform the action. Do NOT just describe what to do. Actually output the tool block.`;

  const userMsg = 'Step: Create test.html file on Desktop with content Hello World';
  
  console.log('=== CALLING LLM ===');
  const result = await modelRouter.routeQuery(prefs, [
    { role: 'system', content: coderPrompt },
    { role: 'user', content: userMsg }
  ], { preferredProvider: 'groq', preferredModel: 'llama-3.3-70b-versatile', autoRoute: false });
  
  console.log('=== LLM RESPONSE ===');
  console.log(result.text);
  console.log('');
  
  // Test parsing
  const toolCalls = systemCommander.parseToolCalls(result.text);
  console.log('=== PARSED TOOL CALLS ===');
  console.log(JSON.stringify(toolCalls, null, 2));
  console.log('Count:', toolCalls.length);
  
  if (toolCalls.length > 0) {
    console.log('\n=== EXECUTING TOOL ===');
    try {
      const execResult = await systemCommander.executeTool(toolCalls[0]);
      console.log('Success:', JSON.stringify(execResult, null, 2));
    } catch (err) {
      console.log('Error:', err.message);
    }
  }
}

test().catch(e => console.error('Fatal:', e));

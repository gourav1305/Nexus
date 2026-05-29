import { Router } from 'express';
import { resolveVoicePrefs } from '../voiceCatalog';
import { synthesizeSpeech } from '../ttsEngine';
import { detectInfoQuery, handleInfoQuery } from '../services/infoServices';
import { detectEmotion, buildSystemPrompt } from '../services/emotionDetector';
import { searchWeb } from '../services/webSearch';
import memoryStore from '../services/memoryStore';
import { optionalAuth } from '../auth';
import modelRouter = require('../services/modelRouter');
import systemCommander = require('../services/systemCommander');
import agentOrchestrator = require('../services/agentOrchestrator');
import {
  getGroq, TTS_VOICE, serverModelPrefs, serverVoiceSettings, updateServerVoiceSettings,
  apiUsage, logEvent, detectMemoryQuery, detectSearchQuery, detectToolNeed,
  pendingSystemAction, setPendingAction, clearPendingAction, COMMAND_TIMEOUT,
  normalizeCommand,
} from './context';
import { detectSystemCommand } from './systemHelpers';

const router = Router();
router.use(optionalAuth);

// ── Vision / Image Analysis ──
router.post('/chat/vision', async (req, res) => {
  try {
    const { message, imageBase64, imageMimeType, voice, rate, voiceMode, speakingRate, language } = req.body || {};
    const voicePrefs = resolveVoicePrefs(
      { voice, rate, voiceMode, speakingRate, language },
      serverVoiceSettings.voice,
    );
    if (!imageBase64) return res.status(400).json({ error: 'No image data provided' });
    const dataUrl = `data:${imageMimeType || 'image/jpeg'};base64,${imageBase64}`;
    const userText = (message || '').trim() || 'What is in this image? Describe it in detail.';
    apiUsage.llmCalls++;
    logEvent('llm', 'Vision call', userText);
    const messages = [{
      role: 'user',
      content: [
        { type: 'text', text: userText },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    }];
    const result = await modelRouter.routeVision(serverModelPrefs, messages, {
      preferredProvider: serverModelPrefs.provider,
      preferredModel: serverModelPrefs.visionModel,
      category: 'general',
      forVision: true,
    });
    const textResponse = result.text;
    if (!textResponse) {
      logEvent('error', 'Vision LLM empty response');
      return res.status(502).json({ error: 'Vision model returned an empty response' });
    }
    const speech = await synthesizeSpeech(textResponse, voicePrefs, TTS_VOICE);
    apiUsage.ttsCalls++;
    res.json({ text: textResponse, ...speech, model: `${result.provider}/${result.model}`, vision: true });
  } catch (err: any) {
    console.error('Vision API Error:', err);
    logEvent('error', 'Vision API error', err.message);
    res.status(500).json({ error: err.message || 'Vision analysis failed' });
  }
});

// ── Main Chat ──
router.post('/chat', async (req, res) => {
  try {
    const { message, voice, rate, voiceMode, speakingRate, language } = req.body || {};
    const voicePrefs = resolveVoicePrefs(
      { voice, rate, voiceMode, speakingRate, language },
      serverVoiceSettings.voice,
    );
    updateServerVoiceSettings({ voice, rate, voiceMode, speakingRate, language });
    if (!message || !message.trim()) return res.status(400).json({ error: 'Message required' });
    apiUsage.totalChats++;

    const userId = (req as any).userId || null;
    const systemCommand = detectSystemCommand(message);

    // Confirmation Logic
    if (pendingSystemAction && Date.now() - pendingSystemAction.time < COMMAND_TIMEOUT) {
      const normalizedMsg = normalizeCommand(message);
      const isConfirmed = normalizedMsg.includes('confirm') || normalizedMsg.includes('yes') || normalizedMsg.includes('haan') || normalizedMsg.includes(pendingSystemAction.keyword);
      if (isConfirmed) {
        const action = pendingSystemAction.action;
        const actionName = pendingSystemAction.name.replace('_init', '');
        clearPendingAction();
        try {
          await action();
          const confirmReply = `${actionName.charAt(0).toUpperCase() + actionName.slice(1)} process initiated successfully.`;
          const speech = await synthesizeSpeech(confirmReply, voicePrefs, TTS_VOICE);
          apiUsage.ttsCalls++;
          logEvent('system', `Confirmation executed: ${actionName}`);
          return res.json({ text: confirmReply, ...speech, model: 'nexus-system-tools' });
        } catch (err: any) {
          const failReply = `NEXUS was unable to complete the action: ${err.message}`;
          const speech = await synthesizeSpeech(failReply, voicePrefs, TTS_VOICE);
          apiUsage.ttsCalls++;
          logEvent('error', `Confirmation failed: ${actionName}`, err.message);
          return res.status(500).json({ text: failReply, ...speech, error: err.message });
        }
      } else if (normalizedMsg.includes('no') || normalizedMsg.includes('cancel') || normalizedMsg.includes('nahi')) {
        clearPendingAction();
        const cancelReply = 'Action cancelled. System standby.';
        const speech = await synthesizeSpeech(cancelReply, voicePrefs, TTS_VOICE);
        apiUsage.ttsCalls++;
        return res.json({ text: cancelReply, ...speech });
      }
    }

    // Info Query
    const infoQuery = detectInfoQuery(message);
    if (infoQuery) {
      try {
        const infoReply = await handleInfoQuery(infoQuery);
        const speech = await synthesizeSpeech(infoReply, voicePrefs, TTS_VOICE);
        apiUsage.infoQueries++;
        apiUsage.ttsCalls++;
        logEvent('info', `${infoQuery.type} query`, message);
        if (userId) {
          try {
            await memoryStore.add(getGroq(), userId, 'user', 'user', message.trim());
            await memoryStore.add(getGroq(), userId, 'nexus', 'assistant', infoReply);
          } catch {}
        }
        return res.json({ text: infoReply, ...speech, model: 'nexus-info', toolUsed: infoQuery.type });
      } catch (infoError: any) {
        console.error('[NEXUS Info] Failed:', infoQuery.type, infoError.message);
        logEvent('error', `Info query failed: ${infoQuery.type}`, infoError.message);
      }
    }

    // System Command
    if (systemCommand) {
      if (systemCommand.requiresConfirmation) {
        setPendingAction({ action: systemCommand.run, name: systemCommand.name, keyword: systemCommand.confirmKeyword, time: Date.now() });
        logEvent('system', `Pending confirmation: ${systemCommand.name}`, message);
      } else {
        try {
          await systemCommand.run(userId, message);
          apiUsage.systemCommands++;
          logEvent('system', `Executed: ${systemCommand.name}`, message);
        } catch (error: any) {
          console.error('[NEXUS Tool] Launch failed:', systemCommand.name, error);
          const failReply = `${systemCommand.name.replace(/_/g, ' ')} open nahi ho paya. Administrator privileges check karein.`;
          const speech = await synthesizeSpeech(failReply, voicePrefs, TTS_VOICE);
          apiUsage.ttsCalls++;
          logEvent('error', `System command failed: ${systemCommand.name}`, error.message);
          return res.status(500).json({ error: failReply, text: failReply, ...speech, model: 'nexus-system-tools', toolUsed: systemCommand.name });
        }
      }
      const speech = await synthesizeSpeech(systemCommand.reply, voicePrefs, TTS_VOICE);
      apiUsage.ttsCalls++;
      if (!systemCommand.requiresConfirmation) apiUsage.systemCommands++;
      return res.json({ text: systemCommand.reply, ...speech, model: 'nexus-system-tools', toolUsed: systemCommand.name });
    }

    // Agent Task Detection
    if (agentOrchestrator.detectTaskRequest(message)) {
      try {
        logEvent('agent', 'Task detected', message);
        const taskResult = await agentOrchestrator.processTask(message.trim(), serverModelPrefs, (type: string, msg: string) => { if (type === 'log') console.log('[Agent]', msg); });
        const taskSummary = taskResult.summary;
        const speech = await synthesizeSpeech(taskSummary, voicePrefs, TTS_VOICE);
        apiUsage.ttsCalls++;
        apiUsage.llmCalls++;
        return res.json({ text: taskSummary, ...speech, model: 'nexus-agent', taskResult });
      } catch (taskErr: any) {
        logEvent('error', 'Agent task failed', taskErr.message);
      }
    }

    if (!process.env.GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY is missing in Backend/.env' });

    apiUsage.llmCalls++;
    logEvent('llm', 'LLM call', message);

    const emotion = detectEmotion(message.trim());
    let systemContent = buildSystemPrompt(
      'You are NEXUS, a concise voice assistant. Reply naturally in the same language or Hinglish style as the user. Keep responses voice-friendly and avoid markdown unless absolutely needed.',
      emotion,
    );
    if (emotion) logEvent('emotion', `Detected: ${emotion.emotion} (score: ${emotion.score})`);

    const needsTools = detectToolNeed(message.trim());
    if (needsTools) {
      systemContent += '\n\n' + systemCommander.buildToolSystemPrompt();
      logEvent('tool', 'Tool instructions added to prompt', message);
    }

    let ragContext = '';
    const needsMemory = userId && detectMemoryQuery(message);
    const needsWebSearch = detectSearchQuery(message);

    if (needsMemory || needsWebSearch) {
      if (needsMemory && userId) {
        try {
          const memories = await memoryStore.query(getGroq(), userId, message, 5);
          if (memories.length > 0) {
            ragContext += '\nPast conversation context:\n' + memories.map((m: any) => `[${m.role}]: ${m.content}`).join('\n') + '\n';
          }
        } catch (memErr: any) {
          logEvent('error', 'Memory retrieval failed', memErr.message);
        }
      }
      if (needsWebSearch) {
        const searchQuery = message.replace(/search|find|look up|google|khoj|dhoondh|dhundo|pata karo|kya\s+hota\s+hai|kya\s+hai|batao|tell me|about|info|yaad\s*dilao|yaad\s*karo|kal|pehle/gi, '').replace(/\s+/g, ' ').trim();
        if (searchQuery.length > 3) {
          try {
            const webResults = await searchWeb(searchQuery, 3);
            if (webResults.snippets.length > 0) {
              ragContext += '\nWeb search results:\n' + webResults.snippets.map((s: string, i: number) => `[${i + 1}] ${s}`).join('\n') + '\nSources: ' + webResults.sources.map((s: any) => s.url).join(', ');
              apiUsage.infoQueries++;
              logEvent('rag', 'Web search for chat', searchQuery);
            }
          } catch (webErr: any) {
            logEvent('error', 'Web search failed in chat', webErr.message);
          }
        }
      }
    }

    if (ragContext) {
      systemContent += '\n\nRelevant context (use this to answer the user):\n' + ragContext;
      logEvent('rag', 'Context injected', `${ragContext.length} chars`);
    }

    const messages = [
      { role: 'system', content: systemContent },
      { role: 'user', content: message.trim() },
    ];

    const isStreaming = req.body.stream === true;

    if (isStreaming) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
      res.write(':ok\n\n');
      const sendEvent = (event: string, data: any) => {
        if (res.writableEnded) return;
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      try {
        let fullText = '';
        const streamResult = await modelRouter.streamRouteQuery(serverModelPrefs, messages, {
          preferredProvider: serverModelPrefs.provider,
          preferredModel: serverModelPrefs.model,
          autoRoute: serverModelPrefs.autoRoute,
        }, (token: string) => {
          fullText += token;
          sendEvent('token', token);
        });

        if (!fullText) {
          sendEvent('error', { message: 'LLM returned an empty response' });
          sendEvent('done', {});
          if (!res.writableEnded) res.end();
          return;
        }

        let displayText = fullText;
        let toolResults: any[] = [];
        const toolCalls = needsTools ? systemCommander.parseToolCalls(fullText) : [];
        for (const tc of toolCalls) {
          try {
            const toolResult = await systemCommander.executeTool(tc);
            toolResults.push({ type: tc.type, action: tc.action, result: toolResult });
            logEvent('tool', `${tc.type}/${tc.action}`, JSON.stringify(tc.params || {}).slice(0, 200));
            apiUsage.systemCommands++;
          } catch (toolErr: any) {
            toolResults.push({ type: tc.type, action: tc.action, error: toolErr.message });
            logEvent('error', `Tool failed: ${tc.type}/${tc.action}`, toolErr.message);
          }
        }

        if (toolCalls.length > 0) {
          sendEvent('tool_result', { tools: toolResults });
          const toolSummary = toolResults.map((t: any) =>
            t.error ? `${t.type}/${t.action}: Error - ${t.error}` : `${t.type}/${t.action}: ${JSON.stringify(t.result).slice(0, 800)}`
          ).join('\n\n');
          const followUpMessages = [
            { role: 'system', content: systemContent },
            { role: 'user', content: message.trim() },
            { role: 'assistant', content: fullText },
            { role: 'user', content: `You used the tools above. Here are the results:\n${toolSummary}\n\nBased on this data, respond to the user's original query naturally. Keep it concise and voice-friendly.` },
          ];
          try {
            let followUpText = '';
            await modelRouter.streamRouteQuery(serverModelPrefs, followUpMessages, {
              preferredProvider: serverModelPrefs.provider,
              preferredModel: serverModelPrefs.model,
              autoRoute: serverModelPrefs.autoRoute,
            }, (token: string) => {
              followUpText += token;
              sendEvent('token', token);
            });
            apiUsage.llmCalls++;
            displayText = followUpText || fullText.replace(/```tool[\s\S]*?```/g, '').trim();
          } catch (followUpErr: any) {
            logEvent('error', 'Tool follow-up LLM failed', followUpErr.message);
            displayText = fullText.replace(/```tool[\s\S]*?```/g, '').trim();
          }
          if (!displayText) {
            const ts = toolResults.map((t: any) => t.error ? `${t.type}/${t.action}: Error - ${t.error}` : `${t.type}/${t.action}: Ok`).join(', ');
            displayText = `Done: ${ts}`;
          }
        }

        if (userId) {
          try {
            await memoryStore.add(getGroq(), userId, 'user', 'user', message.trim());
            await memoryStore.add(getGroq(), userId, 'nexus', 'assistant', displayText);
          } catch (memErr: any) { logEvent('error', 'Memory store failed', memErr.message); }
        }

        const speech = await synthesizeSpeech(displayText, voicePrefs, TTS_VOICE);
        apiUsage.ttsCalls++;
        apiUsage.llmCalls++;

        sendEvent('done', {
          text: displayText, ...speech,
          model: `${streamResult.provider}/${streamResult.model}`,
          emotion: emotion ? emotion.emotion : null,
          ragUsed: Boolean(ragContext), category: streamResult.category,
          fallbacksUsed: streamResult.fallbacksUsed,
          toolCalls: toolCalls.length > 0 ? toolCalls.map((t: any) => ({ type: t.type, action: t.action })) : undefined,
          toolResults: toolResults.length > 0 ? toolResults : undefined,
        });
      } catch (err: any) {
        console.error('Streaming Error:', err);
        sendEvent('error', { message: err.message || 'Backend request failed' });
      } finally {
        if (!res.writableEnded) res.end();
      }
    } else {
      const result = await modelRouter.routeQuery(serverModelPrefs, messages, {
        preferredProvider: serverModelPrefs.provider,
        preferredModel: serverModelPrefs.model,
        autoRoute: serverModelPrefs.autoRoute,
      });
      const textResponse = result.text;
      if (!textResponse) {
        logEvent('error', 'LLM empty response', message);
        return res.status(502).json({ error: 'LLM returned an empty response' });
      }
      let displayText = textResponse;
      let toolResults: any[] = [];
      const toolCalls = needsTools ? systemCommander.parseToolCalls(textResponse) : [];
      for (const tc of toolCalls) {
        try {
          const toolResult = await systemCommander.executeTool(tc);
          toolResults.push({ type: tc.type, action: tc.action, result: toolResult });
          logEvent('tool', `${tc.type}/${tc.action}`, JSON.stringify(tc.params || {}).slice(0, 200));
          apiUsage.systemCommands++;
        } catch (toolErr: any) {
          toolResults.push({ type: tc.type, action: tc.action, error: toolErr.message });
          logEvent('error', `Tool failed: ${tc.type}/${tc.action}`, toolErr.message);
        }
      }
      if (toolCalls.length > 0) {
        const toolSummary = toolResults.map((t: any) =>
          t.error ? `${t.type}/${t.action}: Error - ${t.error}` : `${t.type}/${t.action}: ${JSON.stringify(t.result).slice(0, 800)}`
        ).join('\n\n');
        const followUpMessages = [
          { role: 'system', content: systemContent },
          { role: 'user', content: message.trim() },
          { role: 'assistant', content: textResponse },
          { role: 'user', content: `You used the tools above. Here are the results:\n${toolSummary}\n\nBased on this data, respond to the user's original query naturally. Keep it concise and voice-friendly.` },
        ];
        try {
          const followUpResult = await modelRouter.routeQuery(serverModelPrefs, followUpMessages, {
            preferredProvider: serverModelPrefs.provider,
            preferredModel: serverModelPrefs.model,
            autoRoute: serverModelPrefs.autoRoute,
          });
          apiUsage.llmCalls++;
          displayText = followUpResult.text || textResponse.replace(/```tool[\s\S]*?```/g, '').trim();
        } catch (followUpErr: any) {
          logEvent('error', 'Tool follow-up LLM failed', followUpErr.message);
          displayText = textResponse.replace(/```tool[\s\S]*?```/g, '').trim();
        }
        if (!displayText) {
          const ts = toolResults.map((t: any) => t.error ? `${t.type}/${t.action}: Error - ${t.error}` : `${t.type}/${t.action}: Ok`).join(', ');
          displayText = `Done: ${ts}`;
        }
      }
      if (userId) {
        try {
          await memoryStore.add(getGroq(), userId, 'user', 'user', message.trim());
          await memoryStore.add(getGroq(), userId, 'nexus', 'assistant', textResponse);
        } catch (memErr: any) { logEvent('error', 'Memory store failed', memErr.message); }
      }
      const speech = await synthesizeSpeech(displayText, voicePrefs, TTS_VOICE);
      apiUsage.ttsCalls++;
      apiUsage.llmCalls++;
      res.json({
        text: displayText, ...speech,
        model: `${result.provider}/${result.model}`,
        emotion: emotion ? emotion.emotion : null,
        ragUsed: Boolean(ragContext), category: result.category,
        fallbacksUsed: result.fallbacksUsed,
        toolCalls: toolCalls.length > 0 ? toolCalls.map((t: any) => ({ type: t.type, action: t.action })) : undefined,
        toolResults: toolResults.length > 0 ? toolResults : undefined,
      });
    }
  } catch (err: any) {
    console.error('API Error:', err);
    logEvent('error', 'Chat API error', err.message);
    res.status(500).json({ error: err.message || 'Backend request failed' });
  }
});

export default router;

import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import './App.css';
import Navbar from './component/Navbar';
import ChatHistory from './component/ChatHistory';
import CommandInput from './component/CommandInput';
import Dashboard from './component/Dashboard';
import DataCore from './component/DataCore';
import Recipes from './component/Recipes';
import CodeSandbox from './component/CodeSandbox';
import LoginPage from './component/LoginPage';
import AmbientBackground from './component/AmbientBackground';
import { MessageSquare, X } from 'lucide-react';
import { playStartupHum, playErrorSound, playSuccessSound, playHoverBlip, playClickBlip } from './utils/audioFeedback';
import { extractArtifacts } from './utils/artifactUtils';

const Blob2 = lazy(() => import('./component/blob2'));
const ArtifactPanel = lazy(() => import('./component/ArtifactPanel'));
import {
  loadBlobConfig, loadAssistantSettings, loadUiConfig,
  saveBlobConfig, saveAssistantSettings, saveUiConfig,
  resolveVoicePrefs,
  DEFAULT_BLOB_CONFIG, DEFAULT_UI_CONFIG, DEFAULT_ASSISTANT_SETTINGS,
} from './utils/settingsStorage';

const TOKEN_KEY = 'nexus_token';
const USER_KEY = 'nexus_user';

function getStoredToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function getStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function authHeaders(token) {
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

function App() {
  const [token, setToken] = useState(getStoredToken);
  const [user, setUser] = useState(getStoredUser);
  const [authLoading, setAuthLoading] = useState(!!getStoredToken());

  const [currentView, setCurrentView] = useState('nexus');
  const [assistantEnabled, setAssistantEnabled] = useState(false);

  const [history, setHistory] = useState([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [externalResponse, setExternalResponse] = useState(null);
  const [artifacts, setArtifacts] = useState([]);
  const [artifactsOpen, setArtifactsOpen] = useState(false);

  const [blobConfig, setBlobConfig] = useState(loadBlobConfig);
  const [uiConfig, setUiConfig] = useState(loadUiConfig);
  const [assistantSettings, setAssistantSettings] = useState(loadAssistantSettings);

  const isFirstBlobSave = useRef(true);
  const isFirstUiSave = useRef(true);
  const isFirstAssistantSave = useRef(true);

  // ── Auth: on mount validate token ──
  useEffect(() => {
    const stored = getStoredToken();
    if (!stored) { setAuthLoading(false); return; }
    fetch('/api/auth/me', { headers: authHeaders(stored) })
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          setUser(data.user);
          setToken(stored);
          if (data.settings) {
            if (data.settings.blob_config) setBlobConfig(prev => ({ ...prev, ...data.settings.blob_config }));
            if (data.settings.ui_config) setUiConfig(prev => ({ ...prev, ...data.settings.ui_config }));
            if (data.settings.assistant_settings) setAssistantSettings(prev => ({ ...prev, ...data.settings.assistant_settings }));
          }
          if (data.history) setHistory(data.history);
        } else {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
          setToken(null);
          setUser(null);
        }
      })
      .catch(() => { /* offline mode - keep local state */ })
      .finally(() => setAuthLoading(false));
  }, []);

  // ── Auth: handle login ──
  const handleLogin = useCallback((newToken, newUser, settings, historyData) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USER_KEY, JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
    if (settings) {
      if (settings.blob_config) setBlobConfig(prev => ({ ...prev, ...settings.blob_config }));
      if (settings.ui_config) setUiConfig(prev => ({ ...prev, ...settings.ui_config }));
      if (settings.assistant_settings) setAssistantSettings(prev => ({ ...prev, ...settings.assistant_settings }));
    }
    if (historyData) setHistory(historyData);
  }, []);

  // ── Auth: handle logout ──
  const handleLogout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
    setHistory([]);
    setBlobConfig({ ...DEFAULT_BLOB_CONFIG, isDraggable: false });
    setUiConfig({ ...DEFAULT_UI_CONFIG });
    setAssistantSettings({ ...DEFAULT_ASSISTANT_SETTINGS });
    setCurrentView('nexus');
  }, []);

  const headers = authHeaders(token);

  // ── Settings auto-save ──
  useEffect(() => {
    if (isFirstBlobSave.current) { isFirstBlobSave.current = false; return; }
    saveBlobConfig(blobConfig);
    if (token) {
      fetch('/api/auth/settings/blob', {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(blobConfig),
      }).catch(() => {});
    }
  }, [blobConfig.color, blobConfig.size, blobConfig.sensitivity, blobConfig.position.x, blobConfig.position.y, blobConfig.bloomIntensity, blobConfig.afterimageDamp, blobConfig.rotationSpeed]);

  useEffect(() => {
    if (isFirstUiSave.current) { isFirstUiSave.current = false; return; }
    saveUiConfig(uiConfig);
    if (token) {
      fetch('/api/auth/settings/ui', {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(uiConfig),
      }).catch(() => {});
    }
  }, [uiConfig.particlesEnabled, uiConfig.scanlinesEnabled, uiConfig.audioFeedbackEnabled]);

  useEffect(() => {
    if (isFirstAssistantSave.current) { isFirstAssistantSave.current = false; return; }
    const normalized = saveAssistantSettings(assistantSettings);
    const prefs = resolveVoicePrefs(normalized);
    fetch('/api/settings/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prefs),
    }).catch(() => {});
    if (token) {
      fetch('/api/auth/settings/assistant', {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(normalized),
      }).catch(() => {});
    }
  }, [assistantSettings.language, assistantSettings.ttsVoice, assistantSettings.voiceMode, assistantSettings.speakingRate]);

  useEffect(() => {
    const prefs = resolveVoicePrefs(assistantSettings);
    fetch('/api/settings/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prefs),
    }).catch(() => {});
  }, []);

  useEffect(() => { playStartupHum(); }, []);

  const addHistoryItem = useCallback((role, text) => {
    setHistory(prev => [...prev.slice(-49), { role, text, timestamp: Date.now() }]);
  }, []);

  // ── Recipe polling ──
  const recipeMsgSinceRef = useRef(Date.now());
  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const msgRes = await fetch(`/api/recipes/messages/pending?since=${recipeMsgSinceRef.current}`);
        const msgData = await msgRes.json();
        if (msgData.ok && msgData.messages?.length) {
          recipeMsgSinceRef.current = msgData.serverTime || Date.now();
          for (const msg of msgData.messages) {
            setHistory(prev => [...prev, { role: msg.role || 'system', text: msg.text, timestamp: msg.timestamp }]);
          }
        }
        const blobRes = await fetch('/api/recipes/pending-blob');
        const blobData = await blobRes.json();
        if (blobData.ok && blobData.actions?.length) {
          for (const action of blobData.actions) {
            const update = {};
            if (action.color) update.color = action.color;
            if (action.size) update.size = parseFloat(action.size);
            if (Object.keys(update).length) setBlobConfig(prev => ({ ...prev, ...update }));
          }
        }
      } catch {}
    }, 3000);
    return () => clearInterval(poll);
  }, []);

  // ── Chat send ──
  const handleSendMessage = async (text) => {
    if (!text.trim()) return;
    if (currentView !== 'nexus') setCurrentView('nexus');
    addHistoryItem('user', text);
    setIsThinking(true);
    setExternalResponse(null);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ message: text, ...resolveVoicePrefs(assistantSettings) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Server error');
      addHistoryItem('assistant', data.text);
      playSuccessSound();

      // ── Extract artifacts from code blocks ──
      const newArtifacts = extractArtifacts(data.text, artifacts.length);
      if (newArtifacts.length > 0) {
        setArtifacts(prev => [...prev, ...newArtifacts]);
        setArtifactsOpen(true);
      }

      setExternalResponse({
        text: data.text, userMessage: text,
        audioBase64: data.audioBase64, audioMimeType: data.audioMimeType,
        voicePrefs: resolveVoicePrefs(assistantSettings),
      });
    } catch (err) {
      console.error('Chat Error:', err);
      playErrorSound();
      setExternalResponse({ error: err.message || 'Connection failed', userMessage: text });
    } finally { setIsThinking(false); }
  };

  const handleVisionMessage = async ({ text, imageBase64, imageMimeType }) => {
    if (!imageBase64) return;
    if (currentView !== 'nexus') setCurrentView('nexus');
    const displayText = text || '[Image analysis requested]';
    addHistoryItem('user', `${displayText} 📷`);
    setIsThinking(true);
    setExternalResponse(null);

    try {
      const res = await fetch('/api/chat/vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ message: text || '', imageBase64, imageMimeType, ...resolveVoicePrefs(assistantSettings) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Vision server error');
      addHistoryItem('assistant', data.text);
      playSuccessSound();
      setExternalResponse({
        text: data.text, userMessage: displayText,
        audioBase64: data.audioBase64, audioMimeType: data.audioMimeType,
        voicePrefs: resolveVoicePrefs(assistantSettings),
      });
    } catch (err) {
      console.error('Vision Error:', err);
      playErrorSound();
      setExternalResponse({ error: err.message || 'Vision analysis failed', userMessage: displayText });
    } finally { setIsThinking(false); }
  };

  // ── Artifact handlers ──
  const handleRemoveArtifact = (id) => {
    setArtifacts(prev => prev.filter(a => a.id !== id));
  };
  const handleClearArtifacts = () => {
    setArtifacts([]);
    setArtifactsOpen(false);
  };

  const handleResetSettings = () => {
    const defaults = {
      blob: { ...DEFAULT_BLOB_CONFIG, isDraggable: false },
      ui: { ...DEFAULT_UI_CONFIG },
      assistant: { ...DEFAULT_ASSISTANT_SETTINGS },
    };
    localStorage.removeItem('nexus_settings');
    localStorage.removeItem('nexus_chat_history');
    setBlobConfig(defaults.blob);
    setUiConfig(defaults.ui);
    setAssistantSettings(defaults.assistant);
    setHistory([]);
    if (token) {
      fetch('/api/auth/settings/blob', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(defaults.blob) }).catch(() => {});
      fetch('/api/auth/settings/ui', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(defaults.ui) }).catch(() => {});
      fetch('/api/auth/settings/assistant', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(defaults.assistant) }).catch(() => {});
      fetch('/api/auth/history', { method: 'DELETE', headers }).catch(() => {});
    }
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem('nexus_chat_history');
    if (token) fetch('/api/auth/history', { method: 'DELETE', headers }).catch(() => {});
  };

  // ── Show login screen until auth resolves ──
  if (authLoading) {
    return (
      <div className="app-shell" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="login-loading" style={{ fontSize: 14, color: 'rgba(223,250,255,0.3)', letterSpacing: 2 }}>Establishing secure connection...</div>
      </div>
    );
  }

  if (!token) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div className="app-shell">
      <AmbientBackground particlesEnabled={uiConfig.particlesEnabled} scanlinesEnabled={uiConfig.scanlinesEnabled} />
      <Navbar
        config={blobConfig}
        setConfig={setBlobConfig}
        uiConfig={uiConfig}
        setUiConfig={setUiConfig}
        assistantSettings={assistantSettings}
        setAssistantSettings={setAssistantSettings}
        assistantEnabled={assistantEnabled}
        onInitialize={() => setAssistantEnabled(true)}
        currentView={currentView}
        setView={setCurrentView}
        onResetSettings={handleResetSettings}
        user={user}
        onLogout={handleLogout}
      />

      <main className={`view-container ${currentView === 'dashboard' || currentView === 'datacore' || currentView === 'recipes' || currentView === 'codesandbox' ? 'view-dashboard' : ''}`}>
        {currentView === 'nexus' ? (
          <Suspense fallback={<div className="nexus-loading">Initializing Neural Interface...</div>}>
            <Blob2
              config={blobConfig}
              setConfig={setBlobConfig}
              assistantSettings={assistantSettings}
              assistantEnabled={assistantEnabled}
              isThinkingExternal={isThinking}
              externalResponse={externalResponse}
              onVoiceMessage={handleSendMessage}
            />
          </Suspense>
        ) : currentView === 'datacore' ? (
          <DataCore onSwitchToNexus={() => setCurrentView('nexus')} />
        ) : currentView === 'recipes' ? (
          <Recipes onSwitchToNexus={() => setCurrentView('nexus')} token={token} />
        ) : currentView === 'codesandbox' ? (
          <CodeSandbox onSwitchToNexus={() => setCurrentView('nexus')} />
        ) : (
          <Dashboard
            assistantEnabled={assistantEnabled}
            history={history}
            onAction={handleSendMessage}
            onSwitchToNexus={() => setCurrentView('nexus')}
          />
        )}
      </main>

      <ChatHistory
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        history={history}
        onClear={clearHistory}
      />

      <Suspense fallback={null}>
        <ArtifactPanel
          artifacts={artifacts}
          onRemove={handleRemoveArtifact}
          onClear={handleClearArtifacts}
        />
      </Suspense>

      <button
        className={`history-toggle ${isHistoryOpen ? 'active' : ''}`}
        onClick={() => { if (uiConfig.audioFeedbackEnabled) playClickBlip(); setIsHistoryOpen(!isHistoryOpen); }}
        onMouseEnter={() => { if (uiConfig.audioFeedbackEnabled) playHoverBlip(); }}
        title="Toggle Chat History"
      >
        {isHistoryOpen ? <X size={24} /> : <MessageSquare size={24} />}
      </button>

      <CommandInput
        onSend={handleSendMessage}
        onVisionSend={handleVisionMessage}
        assistantEnabled={assistantEnabled}
        setAssistantEnabled={setAssistantEnabled}
        isThinking={isThinking}
        audioFeedbackEnabled={uiConfig.audioFeedbackEnabled}
      />
    </div>
  );
}

export default App;

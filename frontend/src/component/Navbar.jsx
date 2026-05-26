import React, { useState } from 'react';
import './Navbar.css';
import {
  Hexagon, Search, Bell, Settings, Move, LayoutDashboard, Cpu, Database,
  Palette, Volume2, Sliders, Info, RotateCw, Eye, EyeOff,
  Zap, RefreshCw, Trash2, Music, Mic, TestTube, Activity, LogOut,
} from 'lucide-react';
import {
  VOICE_MODES,
  SPEAKING_RATES,
  applyVoiceMode,
} from '../utils/voiceCatalog';
import {
  playHoverBlip,
  playClickBlip,
  playActivationChime,
  playDeactivationChime,
  playSuccessSound,
} from '../utils/audioFeedback';

let lastHoverTime = 0;

const TABS = [
  { id: 'visual', label: 'Visual', icon: Palette },
  { id: 'voice', label: 'Voice', icon: Volume2 },
  { id: 'system', label: 'System', icon: Sliders },
  { id: 'about', label: 'About', icon: Info },
];

const Navbar = ({
  config, setConfig, uiConfig, setUiConfig,
  assistantSettings, setAssistantSettings,
  assistantEnabled, onInitialize,
  currentView, setView, onResetSettings,
  user, onLogout,
}) => {
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState('visual');
  const [settingsSearch, setSettingsSearch] = useState('');

  const handleColorChange = (e) => {
    setConfig({ ...config, color: e.target.value });
  };

  const handleNavHover = () => {
    const now = Date.now();
    if (now - lastHoverTime > 80) {
      lastHoverTime = now;
      if (uiConfig.audioFeedbackEnabled) playHoverBlip();
    }
  };

  const handleInitializeClick = () => {
    if (uiConfig.audioFeedbackEnabled) {
      if (assistantEnabled) playDeactivationChime();
      else playActivationChime();
    }
    onInitialize();
  };

  const handleSettingsClick = (e) => {
    e.preventDefault();
    if (uiConfig.audioFeedbackEnabled) playClickBlip();
    setShowSettings(!showSettings);
    if (!showSettings) setSettingsSearch('');
  };

  const handleToggle = (key) => {
    setUiConfig({ ...uiConfig, [key]: !uiConfig[key] });
  };

  const searchFilter = (label) => {
    if (!settingsSearch) return true;
    return label.toLowerCase().includes(settingsSearch.toLowerCase());
  };

  const renderVisualPanel = () => (
    <div className="settings-panel">
      {searchFilter('Color') && (
        <div className="setting-row">
          <label>Color</label>
          <div className="color-wrap">
            <span className="color-swatch" style={{ background: config.color }} />
            <input type="color" value={config.color} onChange={handleColorChange} />
          </div>
        </div>
      )}
      {searchFilter('Size') && (
        <div className="setting-row">
          <label>Size: {config.size.toFixed(1)}</label>
          <input type="range" min="0.5" max="3" step="0.1" value={config.size}
            onChange={(e) => setConfig({ ...config, size: parseFloat(e.target.value) })} />
        </div>
      )}
      {searchFilter('Sensitivity') && (
        <div className="setting-row">
          <label>Sensitivity: {config.sensitivity.toFixed(1)}</label>
          <input type="range" min="0.5" max="5.0" step="0.1" value={config.sensitivity}
            onChange={(e) => setConfig({ ...config, sensitivity: parseFloat(e.target.value) })} />
        </div>
      )}
      {searchFilter('Bloom') && (
        <div className="setting-row">
          <label>Bloom: {config.bloomIntensity.toFixed(1)}</label>
          <input type="range" min="0" max="5" step="0.1" value={config.bloomIntensity}
            onChange={(e) => setConfig({ ...config, bloomIntensity: parseFloat(e.target.value) })} />
        </div>
      )}
      {searchFilter('Afterimage') && (
        <div className="setting-row">
          <label>Trail: {config.afterimageDamp.toFixed(2)}</label>
          <input type="range" min="0" max="1" step="0.02" value={config.afterimageDamp}
            onChange={(e) => setConfig({ ...config, afterimageDamp: parseFloat(e.target.value) })} />
        </div>
      )}
      {searchFilter('Rotation') && (
        <div className="setting-row">
          <label>Rotation: {config.rotationSpeed.toFixed(1)}x</label>
          <input type="range" min="0" max="3" step="0.1" value={config.rotationSpeed}
            onChange={(e) => setConfig({ ...config, rotationSpeed: parseFloat(e.target.value) })} />
        </div>
      )}
      {searchFilter('Position') && (
        <div className="setting-row actions">
          <button
            className={`drag-btn ${config.isDraggable ? 'active' : ''}`}
            onClick={() => setConfig({ ...config, isDraggable: !config.isDraggable })}
          >
            <Move size={16} /> {config.isDraggable ? 'Dragging...' : 'Move Blob'}
          </button>
          {config.isDraggable && (
            <button className="save-btn" onClick={() => setConfig({ ...config, isDraggable: false })}>
              Save Position
            </button>
          )}
        </div>
      )}
      {searchFilter('Position') && (
        <div className="setting-row pos-display">
          <span className="pos-label">X: {Math.round(config.position.x)}</span>
          <span className="pos-label">Y: {Math.round(config.position.y)}</span>
        </div>
      )}
    </div>
  );

  const renderVoicePanel = () => (
    <div className="settings-panel">
      {searchFilter('Voice Mode') && (
        <div className="setting-row">
          <label>Voice Mode</label>
          <select
            className="settings-select"
            value={assistantSettings.voiceMode}
            onChange={(e) => setAssistantSettings(applyVoiceMode(assistantSettings, e.target.value))}
          >
            {VOICE_MODES.map((mode) => (
              <option key={mode.id} value={mode.id}>{mode.label}</option>
            ))}
          </select>
        </div>
      )}
      {searchFilter('Speaking Rate') && (
        <div className="setting-row">
          <label>Speaking Rate</label>
          <select
            className="settings-select"
            value={assistantSettings.speakingRate}
            onChange={(e) => setAssistantSettings({ ...assistantSettings, speakingRate: e.target.value })}
          >
            {SPEAKING_RATES.map((rate) => (
              <option key={rate.id} value={rate.id}>{rate.label}</option>
            ))}
          </select>
        </div>
      )}
      {searchFilter('Test') && (
        <div className="setting-row actions">
          <button className="test-voice-btn" onClick={() => {
            if (uiConfig.audioFeedbackEnabled) playSuccessSound();
          }}>
            <TestTube size={16} /> Test Voice
          </button>
        </div>
      )}
      <p className="settings-hint">
        {VOICE_MODES.find((m) => m.id === assistantSettings.voiceMode)?.label || 'Female'} ·
        {VOICE_MODES.find((m) => m.id === assistantSettings.voiceMode)?.language || 'en-IN'} ·
        {SPEAKING_RATES.find((r) => r.id === assistantSettings.speakingRate)?.label || 'Normal'}
      </p>
    </div>
  );

  const renderSystemPanel = () => (
    <div className="settings-panel">
      {searchFilter('Particles') && (
        <div className="setting-row toggle-row" onClick={() => handleToggle('particlesEnabled')}>
          <div className="toggle-info">
            <Zap size={16} className="toggle-icon" />
            <label>Particles</label>
          </div>
          <span className={`toggle-switch ${uiConfig.particlesEnabled ? 'on' : ''}`}>
            <span className="toggle-knob" />
          </span>
        </div>
      )}
      {searchFilter('Scanlines') && (
        <div className="setting-row toggle-row" onClick={() => handleToggle('scanlinesEnabled')}>
          <div className="toggle-info">
            <Eye size={16} className="toggle-icon" />
            <label>Scanlines</label>
          </div>
          <span className={`toggle-switch ${uiConfig.scanlinesEnabled ? 'on' : ''}`}>
            <span className="toggle-knob" />
          </span>
        </div>
      )}
      {searchFilter('Audio') && (
        <div className="setting-row toggle-row" onClick={() => handleToggle('audioFeedbackEnabled')}>
          <div className="toggle-info">
            <Music size={16} className="toggle-icon" />
            <label>Audio Feedback</label>
          </div>
          <span className={`toggle-switch ${uiConfig.audioFeedbackEnabled ? 'on' : ''}`}>
            <span className="toggle-knob" />
          </span>
        </div>
      )}
      {searchFilter('Status') && (
        <div className="setting-row">
          <label>Assistant Status</label>
          <span className={`s-value status-indicator ${assistantEnabled ? 'active' : 'idle'}`}>
            <span className="pulse-dot" />
            {assistantEnabled ? 'LISTENING' : 'STANDBY'}
          </span>
        </div>
      )}
    </div>
  );

  const renderAboutPanel = () => (
    <div className="settings-panel">
      {searchFilter('Version') && (
        <div className="about-row">
          <span className="about-label">App Version</span>
          <span className="about-value">1.0.0</span>
        </div>
      )}
      {searchFilter('Model') && (
        <div className="about-row">
          <span className="about-label">LLM Model</span>
          <span className="about-value">llama-3.1-8b-instant</span>
        </div>
      )}
      {searchFilter('Vision Model') && (
        <div className="about-row">
          <span className="about-label">Vision Model</span>
          <span className="about-value">llama-4-scout-17b</span>
        </div>
      )}
      {searchFilter('Backend') && (
        <div className="about-row">
          <span className="about-label">Backend</span>
          <span className="about-value s-value active">
            <span className="pulse-dot" />ONLINE
          </span>
        </div>
      )}
      {searchFilter('Platform') && (
        <div className="about-row">
          <span className="about-label">Platform</span>
          <span className="about-value">Node.js v24 / Express 5</span>
        </div>
      )}
      {searchFilter('Reset') && (
        <div className="setting-row actions reset-row">
          <button className="reset-btn" onClick={onResetSettings}>
            <Trash2 size={16} /> Reset All Settings
          </button>
        </div>
      )}
    </div>
  );

  const panels = {
    visual: renderVisualPanel,
    voice: renderVoicePanel,
    system: renderSystemPanel,
    about: renderAboutPanel,
  };

  return (
    <nav className="navbar-container">
      <div className="brand-section" onClick={() => setView('nexus')} style={{ cursor: 'pointer' }}>
        <Hexagon className="brand-icon" size={32} strokeWidth={1.5} />
        <span>NEXUS</span>
      </div>

      <ul className="nav-links">
        <li>
          <a href="#"
            className={`nav-item ${currentView === 'dashboard' ? 'active' : ''}`}
            onClick={(e) => { e.preventDefault(); if (uiConfig.audioFeedbackEnabled) playClickBlip(); setView('dashboard'); }}
            onMouseEnter={handleNavHover}
          >
            <LayoutDashboard size={18} className="nav-icon" />
            Dashboard
          </a>
        </li>
        <li>
          <a href="#"
            className={`nav-item ${currentView === 'systems' ? 'active' : ''}`}
            onClick={(e) => { e.preventDefault(); if (uiConfig.audioFeedbackEnabled) playClickBlip(); setView('nexus'); }}
            onMouseEnter={handleNavHover}
          >
            <Cpu size={18} className="nav-icon" />
            Nexus Core
          </a>
        </li>
        <li>
          <a href="#"
            className={`nav-item ${currentView === 'datacore' ? 'active' : ''}`}
            onClick={(e) => { e.preventDefault(); if (uiConfig.audioFeedbackEnabled) playClickBlip(); setView('datacore'); }}
            onMouseEnter={handleNavHover}
          >
            <Database size={18} className="nav-icon" />
            Data Core
          </a>
        </li>
        <li>
          <a href="#"
            className={`nav-item ${currentView === 'recipes' ? 'active' : ''}`}
            onClick={(e) => { e.preventDefault(); if (uiConfig.audioFeedbackEnabled) playClickBlip(); setView('recipes'); }}
            onMouseEnter={handleNavHover}
          >
            <Activity size={18} className="nav-icon" />
            Recipes
          </a>
        </li>
        <li style={{ position: 'relative' }}>
          <a href="#" className="nav-item" onClick={handleSettingsClick} onMouseEnter={handleNavHover}>
            <Settings size={18} className="nav-icon" />
            Settings
          </a>
          {showSettings && (
            <div className="settings-dropdown">
              {/* Search */}
              <div className="settings-search-wrap">
                <Search size={14} className="settings-search-icon" />
                <input
                  type="text"
                  className="settings-search-input"
                  placeholder="Search settings..."
                  value={settingsSearch}
                  onChange={(e) => setSettingsSearch(e.target.value)}
                />
              </div>

              {/* Tabs */}
              <div className="settings-tabs">
                {TABS.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      className={`settings-tab ${settingsTab === tab.id ? 'active' : ''}`}
                      onClick={() => { setSettingsTab(tab.id); setSettingsSearch(''); }}
                    >
                      <Icon size={14} />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Panel Content */}
              {panels[settingsTab]()}
            </div>
          )}
        </li>
      </ul>

      <div className="action-section">
        <button className="icon-btn" aria-label="Search" onMouseEnter={handleNavHover}>
          <Search size={22} strokeWidth={1.5} />
        </button>
        <button className="icon-btn" aria-label="Notifications" onMouseEnter={handleNavHover}>
          <Bell size={22} strokeWidth={1.5} />
        </button>
        {user && (
          <div className="user-profile-nav" onMouseEnter={handleNavHover}>
            <span className="user-profile-name">{user.displayName || user.username}</span>
            <button className="icon-btn logout-btn" onClick={onLogout} title="Logout">
              <LogOut size={16} strokeWidth={1.5} />
            </button>
          </div>
        )}
        <button className={`glow-btn ${assistantEnabled ? 'active' : ''}`} onClick={handleInitializeClick}>
          {assistantEnabled ? 'LISTENING' : 'INITIALIZE'}
        </button>
      </div>
    </nav>
  );
};

export default Navbar;

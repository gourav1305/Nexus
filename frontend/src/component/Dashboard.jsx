import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  Mic, 
  MicOff, 
  Server, 
  Cpu, 
  Settings2, 
  CloudSun,
  Newspaper, 
  BookOpen, 
  Play,
  FileText,
  MessageCircle,
  Command,
  Clock,
  ExternalLink
} from 'lucide-react';

const Dashboard = ({ assistantEnabled, history, onAction, onSwitchToNexus }) => {
  const [backendStatus, setBackendStatus] = useState(null);
  const [availableTools, setAvailableTools] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [healthRes, toolsRes] = await Promise.all([
          fetch('/api/health'),
          fetch('/api/tools')
        ]);
        const health = await healthRes.json();
        const tools = await toolsRes.json();
        setBackendStatus(health);
        setAvailableTools(tools.commands || []);
      } catch (err) {
        console.error('Failed to fetch dashboard data:', err);
      }
    };
    fetchData();
  }, []);

  const quickActions = [
    { label: 'Delhi Weather', icon: <CloudSun className="q-icon" size={20} />, command: 'aaj delhi ka weather kya hai' },
    { label: 'Tech News', icon: <Newspaper className="q-icon" size={20} />, command: 'latest tech news batao' },
    { label: 'Wikipedia', icon: <BookOpen className="q-icon" size={20} />, command: 'virat kohli ke baare me batao' },
    { label: 'Open YouTube', icon: <Play className="q-icon" size={20} />, command: 'open youtube' },
    { label: 'Open Notepad', icon: <FileText className="q-icon" size={20} />, command: 'open notepad' },
    { label: 'Ask AI', icon: <MessageCircle className="q-icon" size={20} />, action: onSwitchToNexus },
  ];

  return (
    <div className="dashboard-wrapper">
      <div className="dashboard-grid">
        
        {/* Row 1: System Status */}
        <section className="dash-card status-card">
          <div className="card-header">
            <Activity size={20} className="header-icon" />
            <h3>NEURAL STATUS</h3>
          </div>
          <div className="status-grid">
            <div className="status-item">
              <span className="s-label">AI Status</span>
              <span className="s-value active">
                <span className="pulse-dot" />
                ONLINE
              </span>
            </div>
            <div className="status-item">
              <span className="s-label">Mic Link</span>
              <span className={`s-value ${assistantEnabled ? 'active' : 'idle'}`}>
                {assistantEnabled ? <Mic size={14} /> : <MicOff size={14} />}
                {assistantEnabled ? 'READY' : 'OFF'}
              </span>
            </div>
            <div className="status-item">
              <span className="s-label">Backend</span>
              <span className={`s-value ${backendStatus?.ok ? 'active' : 'error'}`}>
                <Server size={14} />
                {backendStatus?.ok ? 'STABLE' : 'OFFLINE'}
              </span>
            </div>
          </div>
        </section>

        <section className="dash-card config-card">
          <div className="card-header">
            <Settings2 size={20} className="header-icon" />
            <h3>SYSTEM CONFIG</h3>
          </div>
          <div className="config-list">
            <div className="cfg-item">
              <Cpu size={16} />
              <div className="cfg-info">
                <span className="cfg-label">LLM Core</span>
                <span className="cfg-val">{backendStatus?.model || 'llama-3.1-8b'}</span>
              </div>
            </div>
            <div className="cfg-item">
              <MessageCircle size={16} />
              <div className="cfg-info">
                <span className="cfg-label">Neural Voice</span>
                <span className="cfg-val">
                  {backendStatus?.voiceMode
                    ? `${backendStatus.voiceMode.replace('-', ' ')} · ${backendStatus.speakingRate || 'normal'}`
                    : backendStatus?.voice?.split('-')[1] || 'Neerja'}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Row 2: Quick Launch */}
        <section className="dash-card launcher-card">
          <div className="card-header">
            <Command size={20} className="header-icon" />
            <h3>QUICK LAUNCH</h3>
          </div>
          <div className="launcher-grid">
            {quickActions.map((action, i) => (
              <button 
                key={i} 
                className="q-button"
                onClick={() => action.action ? action.action() : onAction(action.command)}
              >
                {action.icon}
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Row 3: Available Commands & History */}
        <section className="dash-card commands-card">
          <div className="card-header">
            <Command size={20} className="header-icon" />
            <h3>NEURAL COMMANDS</h3>
          </div>
          <div className="commands-list">
            {availableTools.map((cmd, i) => (
              <div key={i} className="cmd-tag" onClick={() => onAction(cmd)}>
                <ExternalLink size={12} />
                {cmd}
              </div>
            ))}
          </div>
        </section>

        <section className="dash-card history-card">
          <div className="card-header">
            <Clock size={20} className="header-icon" />
            <h3>RECENT ACTIVITY</h3>
          </div>
          <div className="activity-list">
            {history.slice(-5).reverse().map((item, i) => (
              <div key={i} className={`activity-item ${item.role}`}>
                <span className="act-marker" />
                <p>{item.text.slice(0, 45)}{item.text.length > 45 ? '...' : ''}</p>
              </div>
            ))}
            {history.length === 0 && <p className="empty-msg">No recent activity detected.</p>}
          </div>
        </section>

      </div>
    </div>
  );
};

export default Dashboard;

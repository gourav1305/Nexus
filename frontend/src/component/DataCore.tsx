// @ts-nocheck
import React, { useState, useEffect, useCallback, useRef } from 'react';
import './DataCore.css';
import {
  Server, Cpu, HardDrive, Activity, Zap, Clock, BarChart3,
  MessageCircle, Volume2, Search, Terminal, AlertCircle,
  RefreshCw, ChevronDown, ChevronUp, Filter
} from 'lucide-react';

const CATEGORY_COLORS = {
  llm: '#7dfbff',
  system: '#cfa6ff',
  info: '#5fffd0',
  error: '#ff6b6b',
  tts: '#ffb347',
};

const CATEGORY_LABELS = {
  llm: 'LLM',
  system: 'SYSTEM',
  info: 'INFO',
  error: 'ERROR',
  tts: 'TTS',
};

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

const Gauge = ({ value, label, max = 100, color = '#7dfbff' }) => {
  const pct = Math.min((value / max) * 100, 100);
  const r = 36;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="datacore-gauge">
      <svg width="90" height="90" viewBox="0 0 90 90">
        <circle cx="45" cy="45" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5" />
        <circle cx="45" cy="45" r={r} fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 45 45)"
          style={{ transition: 'stroke-dashoffset 0.8s ease' }}
        />
        <text x="45" y="40" textAnchor="middle" fill="#fff" fontSize="16" fontFamily="'Orbitron',sans-serif" fontWeight="700">
          {Math.round(pct)}%
        </text>
        <text x="45" y="55" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="9" fontFamily="'Inter',sans-serif">
          USED
        </text>
      </svg>
      <span className="gauge-label">{label}</span>
    </div>
  );
};

function DataCore({ onSwitchToNexus }) {
  const [stats, setStats] = useState(null);
  const [usage, setUsage] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logFilter, setLogFilter] = useState('');
  const [logCategory, setLogCategory] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [expandedLog, setExpandedLog] = useState(null);
  const logsEndRef = useRef(null);
  const logsContainerRef = useRef(null);
  const prevLogLength = useRef(0);
  const intervalRef = useRef(null);

  const buildLogUrl = useCallback(() => {
    const params = new URLSearchParams();
    params.set('limit', '60');
    if (logCategory) params.set('category', logCategory);
    if (logFilter) params.set('search', logFilter);
    return `/api/system/logs?${params.toString()}`;
  }, [logCategory, logFilter]);

  const fetchData = useCallback(async () => {
    try {
      const [statsRes, usageRes, logsRes] = await Promise.all([
        fetch('/api/system/stats'),
        fetch('/api/system/usage'),
        fetch(buildLogUrl()),
      ]);
      if (statsRes.ok) setStats(await statsRes.json());
      if (usageRes.ok) setUsage(await usageRes.json());
      if (logsRes.ok) {
        const logsData = await logsRes.json();
        setLogs(logsData.entries || []);
      }
    } catch (err) {
      console.warn('DataCore fetch error:', err);
    }
  }, [buildLogUrl]);

  useEffect(() => {
    fetchData();
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchData, 3000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData, autoRefresh]);

  useEffect(() => {
    const added = logs.length > prevLogLength.current;
    prevLogLength.current = logs.length;
    if (!added) return;
    const el = logsContainerRef.current;
    if (!el) return;
    const threshold = 40;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    if (isNearBottom) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const categories = ['', 'llm', 'system', 'info', 'error', 'tts'];

  return (
    <div className="dashboard-wrapper datacore-wrapper">
      <div className="datacore-header">
        <div className="datacore-header-left">
          <Server size={22} className="datacore-header-icon" />
          <h2>DATA CORE</h2>
          <span className="datacore-subtitle">Real-Time System Monitor</span>
        </div>
        <div className="datacore-header-right">
          <span className={`datacore-status ${autoRefresh ? 'live' : 'paused'}`}>
            <span className="pulse-dot" />
            {autoRefresh ? 'LIVE' : 'PAUSED'}
          </span>
          <button className="datacore-btn" onClick={() => setAutoRefresh(!autoRefresh)} title="Toggle Auto-Refresh">
            <RefreshCw size={16} className={autoRefresh ? 'spin' : ''} />
          </button>
          <button className="datacore-btn" onClick={fetchData} title="Refresh Now">
            <Zap size={16} />
          </button>
          <button className="datacore-btn" onClick={onSwitchToNexus} title="Back to Nexus Core">
            <Terminal size={16} />
            <span>Nexus Core</span>
          </button>
        </div>
      </div>

      {/* Row 1: System Stats */}
      <div className="dashboard-grid datacore-grid">
        <section className="dash-card">
          <div className="card-header">
            <Cpu size={20} className="header-icon" />
            <h3>PROCESSOR</h3>
          </div>
          <div className="dcard-body">
            <div className="dcard-stats">
              <div className="dcard-stat">
                <span className="dcard-stat-label">Model</span>
                <span className="dcard-stat-value cpu-model">{stats?.cpu?.model || '—'}</span>
              </div>
              <div className="dcard-stat">
                <span className="dcard-stat-label">Cores</span>
                <span className="dcard-stat-value">{stats?.cpu?.cores || '—'}</span>
              </div>
              <div className="dcard-stat-row">
                <div className="dcard-stat-mini">
                  <span className="mini-label">1 min</span>
                  <span className="mini-value">{stats?.cpu?.load1 || '0.00'}</span>
                </div>
                <div className="dcard-stat-mini">
                  <span className="mini-label">5 min</span>
                  <span className="mini-value">{stats?.cpu?.load5 || '0.00'}</span>
                </div>
                <div className="dcard-stat-mini">
                  <span className="mini-label">15 min</span>
                  <span className="mini-value">{stats?.cpu?.load15 || '0.00'}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="dash-card">
          <div className="card-header">
            <Activity size={20} className="header-icon" />
            <h3>MEMORY</h3>
          </div>
          <div className="dcard-body center">
            <Gauge
              value={stats?.memory?.usagePercent || 0}
              max={100}
              label={`${formatBytes(stats?.memory?.used)} / ${formatBytes(stats?.memory?.total)}`}
              color="#7dfbff"
            />
          </div>
        </section>

        <section className="dash-card">
          <div className="card-header">
            <HardDrive size={20} className="header-icon" />
            <h3>STORAGE</h3>
          </div>
          <div className="dcard-body storage-body">
            {Array.isArray(stats?.disk) ? (
              stats.disk.map((drive, i) => {
                const total = drive.GBUsed + drive.GBFree;
                const pct = total > 0 ? (drive.GBUsed / total) * 100 : 0;
                return (
                  <div key={i} className="disk-row">
                    <div className="disk-info">
                      <span className="disk-name">{drive.Name}:</span>
                      <span className="disk-size">{drive.GBUsed}GB / {drive.GBTotal}GB</span>
                    </div>
                    <div className="disk-bar-track">
                      <div className="disk-bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })
            ) : (
              <span className="dcard-empty">Disk data unavailable</span>
            )}
          </div>
        </section>
      </div>

      {/* Row 2: API Usage */}
      <div className="dashboard-grid datacore-grid">
        <section className="dash-card dcard-wide">
          <div className="card-header">
            <BarChart3 size={20} className="header-icon" />
            <h3>API USAGE COUNTERS</h3>
          </div>
          <div className="dcard-body">
            <div className="counter-grid">
              <div className="counter-item">
                <MessageCircle size={20} className="counter-icon llm" />
                <span className="counter-value">{usage?.counters?.groqCalls || 0}</span>
                <span className="counter-label">Groq LLM Calls</span>
              </div>
              <div className="counter-item">
                <Volume2 size={20} className="counter-icon tts" />
                <span className="counter-value">{usage?.counters?.ttsCalls || 0}</span>
                <span className="counter-label">TTS Syntheses</span>
              </div>
              <div className="counter-item">
                <Terminal size={20} className="counter-icon system" />
                <span className="counter-value">{usage?.counters?.systemCommands || 0}</span>
                <span className="counter-label">System Commands</span>
              </div>
              <div className="counter-item">
                <Search size={20} className="counter-icon info" />
                <span className="counter-value">{usage?.counters?.infoQueries || 0}</span>
                <span className="counter-label">Info Queries</span>
              </div>
              <div className="counter-item">
                <Activity size={20} className="counter-icon" style={{ color: '#ffb347' }} />
                <span className="counter-value">{usage?.counters?.totalChats || 0}</span>
                <span className="counter-label">Total Chats</span>
              </div>
              <div className="counter-item">
                <Clock size={20} className="counter-icon" style={{ color: '#5fffd0' }} />
                <span className="counter-value">{usage ? formatUptime(usage.uptime) : '—'}</span>
                <span className="counter-label">Session Uptime</span>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Row 3: Event Log */}
      <section className="dash-card datacore-log-section">
        <div className="log-header">
          <div className="log-header-left">
            <Terminal size={18} className="header-icon" />
            <h3>EVENT LOG</h3>
            <span className="log-count">{logs.length} events</span>
          </div>
          <div className="log-header-right">
            <div className="log-filter-group">
              <Filter size={14} className="filter-icon" />
              <select className="log-category-select" value={logCategory} onChange={e => setLogCategory(e.target.value)}>
                {categories.map(c => (
                  <option key={c} value={c}>{c ? CATEGORY_LABELS[c] || c.toUpperCase() : 'ALL'}</option>
                ))}
              </select>
            </div>
            <div className="log-search-wrap">
              <input
                type="text"
                className="log-search-input"
                placeholder="Search logs..."
                value={logFilter}
                onChange={e => setLogFilter(e.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="log-list" ref={logsContainerRef}>
          {logs.length === 0 ? (
            <div className="log-empty">No events recorded yet.</div>
          ) : (
            logs.map((entry) => (
              <div
                key={entry.id}
                className={`log-entry ${expandedLog === entry.id ? 'expanded' : ''}`}
                onClick={() => setExpandedLog(expandedLog === entry.id ? null : entry.id)}
              >
                <div className="log-entry-main">
                  <span className="log-dot" style={{ background: CATEGORY_COLORS[entry.category] || '#666' }} />
                  <span className="log-time">{formatTime(entry.timestamp)}</span>
                  <span className="log-cat" style={{ color: CATEGORY_COLORS[entry.category] || '#666' }}>
                    {CATEGORY_LABELS[entry.category] || entry.category?.toUpperCase() || 'EVENT'}
                  </span>
                  <span className="log-msg">{entry.message}</span>
                  {entry.detail && (
                    <span className="log-expand-icon">
                      {expandedLog === entry.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </span>
                  )}
                </div>
                {expandedLog === entry.id && entry.detail && (
                  <div className="log-detail">
                    <code>{entry.detail}</code>
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </section>
    </div>
  );
}

export default DataCore;

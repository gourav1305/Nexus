// @ts-nocheck
import React, { useState, useRef } from 'react';
import { Eye, Monitor, MousePointer, Type, ArrowUpDown, Loader, X, Maximize2 } from 'lucide-react';
import './ScreenAnalyzer.css';

const ACTIONS = [
  { id: 'click', label: 'Click', icon: MousePointer, desc: 'Click at position (x, y)' },
  { id: 'type', label: 'Type', icon: Type, desc: 'Type text on screen' },
  { id: 'scroll', label: 'Scroll', icon: ArrowUpDown, desc: 'Scroll up/down' },
];

export default function ScreenAnalyzer() {
  const [query, setQuery] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState(null);
  const [screenshot, setScreenshot] = useState(null);
  const [logs, setLogs] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);
  const imgRef = useRef(null);

  const handleAnalyze = async () => {
    if (!query.trim() || analyzing) return;
    setAnalyzing(true);
    setResult(null);
    setScreenshot(null);
    setLogs([]);

    try {
      const res = await fetch('/api/screen/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim() }),
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;

          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const event = currentEvent || 'message';
            currentEvent = null;
            try {
              const data = JSON.parse(line.slice(6));
              if (event === 'log') {
                setLogs(prev => [...prev, data.text]);
              } else if (event === 'result') {
                setResult(data.text);
                setScreenshot(data.screenshot);
              } else if (event === 'error') {
                setLogs(prev => [...prev, `❌ ${data.message}`]);
              }
            } catch {}
          }
        }
      }
    } catch (err) {
      setLogs(prev => [...prev, `❌ Connection error: ${err.message}`]);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleAction = async (actionId) => {
    if (actionLoading) return;
    setActionLoading(actionId);

    const params = {};
    if (actionId === 'click') {
      const x = parseInt(prompt('X coordinate:') || '0');
      const y = parseInt(prompt('Y coordinate:') || '0');
      if (!x && !y) { setActionLoading(null); return; }
      params.x = x; params.y = y;
    } else if (actionId === 'type') {
      const text = prompt('Text to type:');
      if (!text) { setActionLoading(null); return; }
      params.text = text;
    } else if (actionId === 'scroll') {
      const dir = confirm('Click OK for down, Cancel for up');
      params.direction = dir ? 'down' : 'up';
      params.amount = parseInt(prompt('Lines:') || '3');
    }

    try {
      const res = await fetch('/api/system/screen-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: actionId, params }),
      });
      const data = await res.json();
      setLogs(prev => [...prev, `✅ ${actionId}: ${data.message || 'Done'}`]);
    } catch (err) {
      setLogs(prev => [...prev, `❌ ${actionId} failed: ${err.message}`]);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="screen-analyzer">
      <div className="screen-analyzer-header">
        <Monitor size={20} />
        <span>Desktop Screen Analysis</span>
      </div>

      <div className="screen-analyzer-input">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
          placeholder="Ask about your screen... 'Is folder mein kya hai?' 'Error message padho'"
          disabled={analyzing}
        />
        <button className="sa-analyze-btn" onClick={handleAnalyze} disabled={analyzing || !query.trim()}>
          {analyzing ? <Loader size={16} className="spin" /> : <Eye size={16} />}
          {analyzing ? 'Analyzing...' : 'Analyze'}
        </button>
      </div>

      {logs.length > 0 && (
        <div className="sa-logs">
          {logs.map((log, i) => (
            <div key={i} className="sa-log-line">{log}</div>
          ))}
        </div>
      )}

      {screenshot && (
        <div className="sa-screenshot-wrap">
          <div className="sa-screenshot-header">
            <span>Screenshot</span>
            <div className="sa-screenshot-actions">
              <button onClick={() => setExpanded(!expanded)} title={expanded ? 'Shrink' : 'Expand'}>
                {expanded ? <X size={14} /> : <Maximize2 size={14} />}
              </button>
            </div>
          </div>
          <div className={`sa-screenshot ${expanded ? 'expanded' : ''}`}>
            <img ref={imgRef} src={`data:image/png;base64,${screenshot}`} alt="Desktop screenshot" />
          </div>
        </div>
      )}

      {result && (
        <div className="sa-result">
          <div className="sa-result-header">Analysis Result</div>
          <p>{result}</p>
        </div>
      )}

      <div className="sa-actions">
        <div className="sa-actions-label">Screen Actions</div>
        <div className="sa-actions-row">
          {ACTIONS.map(({ id, label, icon: Icon, desc }) => (
            <button
              key={id}
              className="sa-action-btn"
              onClick={() => handleAction(id)}
              disabled={actionLoading === id}
              title={desc}
            >
              {actionLoading === id ? <Loader size={14} className="spin" /> : <Icon size={14} />}
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

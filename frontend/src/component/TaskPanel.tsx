// @ts-nocheck
import React, { useState, useRef } from 'react';
import { Terminal, CheckCircle, XCircle, Loader, FileCode, Play } from 'lucide-react';
import './TaskPanel.css';

const TaskPanel = ({ onClose }) => {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('idle');
  const [logs, setLogs] = useState([]);
  const [steps, setSteps] = useState([]);
  const [result, setResult] = useState(null);
  const abortRef = useRef(null);

  const handleRun = async () => {
    if (!query.trim()) return;
    setStatus('running');
    setLogs([{ type: 'log', text: `🚀 Starting task: "${query}"` }]);
    setSteps([]);
    setResult(null);

    const abortCtrl = new AbortController();
    abortRef.current = abortCtrl;

    try {
      const res = await fetch('/api/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: query }),
        signal: abortCtrl.signal,
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
                setLogs(prev => [...prev, { type: 'log', text: data.text }]);
              } else if (event === 'step') {
                setSteps(prev => [...prev, { current: data.current, total: data.total, text: data.text }]);
              } else if (event === 'done') {
                setResult(data);
                setStatus('done');
                setLogs(prev => [...prev, { type: 'done', text: `✅ ${data.summary}` }]);
              }
            } catch {}
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setLogs(prev => [...prev, { type: 'error', text: `Error: ${err.message}` }]);
        setStatus('error');
      }
    }
  };

  const handleCancel = () => {
    if (abortRef.current) abortRef.current.abort();
    setStatus('cancelled');
    setLogs(prev => [...prev, { type: 'log', text: '⛔ Task cancelled' }]);
  };

  return (
    <div className="task-panel">
      <div className="task-panel-header">
        <Terminal size={16} />
        <span>NEXUS Agent</span>
        {onClose && (
          <button className="task-btn-icon" onClick={onClose}>✕</button>
        )}
      </div>

      <div className="task-input-row">
        <input
          className="task-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleRun()}
          placeholder="Describe the task... (e.g., Desktop pe weather app banao)"
          disabled={status === 'running'}
        />
        {status === 'running' ? (
          <button className="task-btn task-btn-cancel" onClick={handleCancel}>
            <XCircle size={16} /> Cancel
          </button>
        ) : (
          <button className="task-btn task-btn-run" onClick={handleRun} disabled={!query.trim()}>
            <Play size={16} /> Run
          </button>
        )}
      </div>

      {/* Steps progress */}
      {steps.length > 0 && (
        <div className="task-steps">
          {steps.map((s, i) => (
            <div key={i} className={`task-step ${s.current <= (steps[i + 1]?.current || s.current) ? 'active' : ''}`}>
              <span className="task-step-num">{s.current}/{s.total}</span>
              <span className="task-step-text">{s.text.replace(/.*Step \d+\/\d+: /, '')}</span>
              {s.current === steps[steps.length - 1]?.current && status === 'running' && (
                <Loader size={12} className="spin" />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Logs */}
      <div className="task-logs">
        {logs.map((log, i) => (
          <div key={i} className={`task-log-line ${log.type}`}>{log.text}</div>
        ))}
        {status === 'running' && <div className="task-log-line system pulse">Processing...</div>}
      </div>

      {/* Result summary */}
      {result && (
        <div className="task-result">
          <div className="task-result-header">
            <CheckCircle size={14} className="success" />
            <span>Task Complete ({result.duration}s)</span>
          </div>
          <div className="task-result-meta">
            <span>{result.successfulSteps}/{result.totalSteps} steps</span>
            <span>{result.filesCreated.length} files created</span>
          </div>
          {result.filesCreated.length > 0 && (
            <div className="task-files">
              {result.filesCreated.map((f, i) => (
                <div key={i} className="task-file-item">
                  <FileCode size={12} /> {f}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TaskPanel;

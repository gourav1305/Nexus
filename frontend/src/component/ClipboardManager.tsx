// @ts-nocheck
import { useState, useEffect } from 'react';
import { Clipboard, Copy, Trash2, RefreshCw, FileText, AlertCircle } from 'lucide-react';
import './ClipboardManager.css';

const API = '/api/system';

export default function ClipboardManager({ onSwitchToNexus }) {
  const [text, setText] = useState('');
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [writeText, setWriteText] = useState('');

  const showError = (msg) => { setError(msg); setTimeout(() => setError(null), 3000); };
  const showSuccess = (msg) => { setSuccess(msg); setTimeout(() => setSuccess(null), 2000); };

  const readClipboard = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/clipboard-read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      setText(d.result?.text || '');
      setHistory(d.result?.history || []);
    } catch (e) { showError(e.message); }
    finally { setLoading(false); }
  };

  const writeClipboard = async () => {
    if (!writeText.trim()) return;
    setLoading(true);
    try {
      const r = await fetch(`${API}/clipboard-write`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: writeText }) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      showSuccess('Copied to clipboard!');
      setText(writeText);
      setHistory(d.result?.history || []);
      setWriteText('');
    } catch (e) { showError(e.message); }
    finally { setLoading(false); }
  };

  const loadHistory = async () => {
    try {
      const r = await fetch(`${API}/clipboard-history`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await r.json();
      if (d.ok) setHistory(d.result?.history || []);
    } catch {}
  };

  useEffect(() => { readClipboard(); }, []);

  return (
    <div className="clipboard-manager">
      <div className="clipboard-header">
        <h2><Clipboard size={20} /> Clipboard Manager</h2>
        <div className="clipboard-header-actions">
          <button className="clipboard-refresh-btn" onClick={readClipboard} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
          </button>
          <button className="clipboard-back-btn" onClick={onSwitchToNexus}>Back to Nexus</button>
        </div>
      </div>

      {error && <div className="clipboard-toast error"><AlertCircle size={14} /> {error}</div>}
      {success && <div className="clipboard-toast success"><Copy size={14} /> {success}</div>}

      <div className="clipboard-body">
        <div className="clipboard-section">
          <h3>Current Clipboard</h3>
          <div className="clipboard-current">
            {text || <span className="clipboard-empty-text">(empty)</span>}
          </div>
        </div>

        <div className="clipboard-section">
          <h3>Write to Clipboard</h3>
          <div className="clipboard-write-row">
            <textarea
              className="clipboard-textarea"
              placeholder="Type or paste text to copy to clipboard..."
              value={writeText}
              onChange={e => setWriteText(e.target.value)}
              rows={3}
            />
            <button className="clipboard-copy-btn" onClick={writeClipboard} disabled={loading || !writeText.trim()}>
              <Copy size={14} /> Copy
            </button>
          </div>
        </div>

        <div className="clipboard-section">
          <div className="clipboard-history-header">
            <h3>History</h3>
            <button className="clipboard-refresh-btn" onClick={loadHistory}><RefreshCw size={12} /> Refresh</button>
          </div>
          <div className="clipboard-history-list">
            {history.length === 0 && <div className="clipboard-empty-text">No clipboard history yet</div>}
            {history.map((item, i) => (
              <div key={i} className="clipboard-history-item" onClick={() => { setWriteText(item.text); }}>
                <div className="clipboard-history-text">{item.text}</div>
                <div className="clipboard-history-date">{new Date(item.timestamp).toLocaleTimeString()}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

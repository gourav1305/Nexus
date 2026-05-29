import { useState } from 'react';
import { FileText, Loader, AlertCircle, Search } from 'lucide-react';
import './DocReader.css';

export default function DocReader({ onSwitchToNexus }) {
  const [filePath, setFilePath] = useState('');
  const [text, setText] = useState('');
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleRead = async () => {
    if (!filePath.trim()) return;
    setLoading(true); setError(null); setText(''); setMeta(null);
    try {
      const r = await fetch('/api/system/read-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath.trim() }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      const result = d.result;
      setText(result.text || result.message || '(empty)');
      setMeta({ path: result.path, type: result.type, pages: result.pages });
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const handleKeyDown = (e) => { if (e.key === 'Enter') handleRead(); };

  return (
    <div className="doc-reader">
      <div className="doc-reader-header">
        <h2><FileText size={20} /> Document Reader</h2>
        <span className="doc-reader-formats">Supports: .pdf, .docx</span>
        <button className="doc-reader-back-btn" onClick={onSwitchToNexus}>Back to Nexus</button>
      </div>

      <div className="doc-reader-toolbar">
        <input
          className="doc-reader-input"
          placeholder="Full path to document (e.g. C:\Users\...\file.pdf)"
          value={filePath}
          onChange={e => setFilePath(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button className="doc-reader-go" onClick={handleRead} disabled={loading || !filePath.trim()}>
          {loading ? <Loader size={16} className="spin" /> : <FileText size={16} />}
          {loading ? 'Reading...' : 'Read Document'}
        </button>
      </div>

      {error && <div className="doc-reader-error"><AlertCircle size={14} /> {error}</div>}

      <div className="doc-reader-content">
        {meta && (
          <div className="doc-reader-meta">
            File: {meta.path} | Type: {meta.type?.toUpperCase()} {meta.pages ? `| Pages: ${meta.pages}` : ''}
          </div>
        )}
        {text && (
          <div className="doc-reader-text">
            {text}
          </div>
        )}
        {!text && !loading && !error && (
          <div className="doc-reader-placeholder">
            <FileText size={48} />
            <p>Enter a file path and click "Read Document" to extract text from PDF or DOCX files.</p>
          </div>
        )}
      </div>
    </div>
  );
}

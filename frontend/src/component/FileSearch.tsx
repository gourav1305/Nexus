// @ts-nocheck
import { useState } from 'react';
import { Search, File, Folder, Loader, AlertCircle, X } from 'lucide-react';
import './FileSearch.css';

const API = '/api/system';

export default function FileSearch({ onSwitchToNexus }) {
  const [query, setQuery] = useState('');
  const [path, setPath] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true); setError(null); setSearched(true);
    try {
      const r = await fetch(`${API}/file-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), path: path.trim() || undefined }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      setResults(d.result?.results || []);
    } catch (e) { setError(e.message); setResults([]); }
    finally { setLoading(false); }
  };

  const handleKeyDown = (e) => { if (e.key === 'Enter') handleSearch(); };

  const formatSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  };

  return (
    <div className="file-search">
      <div className="file-search-header">
        <h2><Search size={20} /> File Search</h2>
        <button className="file-search-back-btn" onClick={onSwitchToNexus}>Back to Nexus</button>
      </div>

      <div className="file-search-toolbar">
        <div className="file-search-input-wrap">
          <Search size={16} className="file-search-input-icon" />
          <input
            className="file-search-input"
            placeholder="Search for files..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {query && <X size={16} className="file-search-clear" onClick={() => setQuery('')} />}
        </div>
        <input
          className="file-search-path"
          placeholder="Search path (optional, e.g. C:\Users\...)"
          value={path}
          onChange={e => setPath(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button className="file-search-go" onClick={handleSearch} disabled={loading || !query.trim()}>
          {loading ? <Loader size={16} className="spin" /> : <Search size={16} />}
          {loading ? 'Searching...' : 'Search'}
        </button>
      </div>

      {error && <div className="file-search-error"><AlertCircle size={14} /> {error}</div>}

      <div className="file-search-results">
        {loading && <div className="file-search-status"><Loader size={16} className="spin" /> Searching...</div>}
        {!loading && searched && results.length === 0 && <div className="file-search-status">No files found</div>}
        {!loading && results.length > 0 && (
          <>
            <div className="file-search-count">{results.length} result{results.length !== 1 ? 's' : ''}</div>
            <div className="file-search-list">
              {results.map((file, i) => (
                <div key={i} className="file-search-item">
                  <File size={14} className="file-search-item-icon" />
                  <div className="file-search-item-info">
                    <div className="file-search-item-path">{file.path}</div>
                    <div className="file-search-item-meta">
                      {formatSize(file.size)}
                      {file.modified ? ` | ${new Date(file.modified).toLocaleDateString()}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

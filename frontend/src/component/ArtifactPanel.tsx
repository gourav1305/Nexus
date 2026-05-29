// @ts-nocheck
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Edit3, Play, Eye, Terminal, Copy, Check } from 'lucide-react';
import './ArtifactPanel.css';
import { extractArtifacts, stripCodeBlocks } from '../utils/artifactUtils';

// ── Syntax Highlighting (regex-based, no deps) ──
const HIGHLIGHTERS = {
  python: (code) =>
    code
      .replace(/(#.*)/g, '<span class="hl-comment">$1</span>')
      .replace(/\b(import|from|def|class|return|if|elif|else|for|while|try|except|finally|with|as|pass|break|continue|and|or|not|in|is|lambda|yield|async|await|print|range|len|int|str|float|list|dict|set|True|False|None)\b/g, '<span class="hl-keyword">$1</span>')
      .replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, '<span class="hl-string">"$1"</span>')
      .replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, "<span class='hl-string'>'$1'</span>")
      .replace(/\b(\d+\.?\d*)\b/g, '<span class="hl-number">$1</span>'),

  javascript: (code) =>
    code
      .replace(/(\/\/.*)/g, '<span class="hl-comment">$1</span>')
      .replace(/\/\*[\s\S]*?\*\//g, '<span class="hl-comment">$&</span>')
      .replace(/\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|delete|typeof|instanceof|class|extends|import|export|default|from|async|await|try|catch|finally|throw|this|true|false|null|undefined|NaN|console|document|window|require|module)\b/g, '<span class="hl-keyword">$1</span>')
      .replace(/`([^`]*)`/g, '<span class="hl-string">`$1`</span>')
      .replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, '<span class="hl-string">"$1"</span>')
      .replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, "<span class='hl-string'>'$1'</span>")
      .replace(/\b(\d+\.?\d*)\b/g, '<span class="hl-number">$1</span>'),

  html: (code) =>
    code
      .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="hl-comment">$1</span>')
      .replace(/(&lt;\/?)(\w+)/g, '$1<span class="hl-tag">$2</span>')
      .replace(/(\w+)(=)(&quot;|")/g, '<span class="hl-attr">$1</span>$2$3'),

  css: (code) =>
    code
      .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="hl-comment">$1</span>')
      .replace(/([\w-]+)(\s*:)/g, '<span class="hl-prop">$1</span>$2')
      .replace(/(#[0-9a-fA-F]{3,6})/g, '<span class="hl-number">$1</span>')
      .replace(/\b(\d+)(px|em|rem|%|vh|vw|s)\b/g, '<span class="hl-number">$1$2</span>'),

  bash: (code) =>
    code
      .replace(/(#.*)/g, '<span class="hl-comment">$1</span>')
      .replace(/\b(echo|export|source|if|then|else|fi|for|while|do|done|case|esac|function|return|exit|cd|ls|cat|grep|sed|awk|rm|cp|mv|mkdir|chmod|chown|sudo|apt|yum|pip|npm|node|python|git|docker)\b/g, '<span class="hl-keyword">$1</span>')
      .replace(/"([^"]*)"/g, '<span class="hl-string">"$1"</span>')
      .replace(/'([^']*)'/g, "<span class='hl-string'>'$1'</span>"),
};

const LANG_MAP = {
  python: 'python', py: 'python',
  javascript: 'javascript', js: 'javascript', node: 'javascript',
  html: 'html', htm: 'html',
  css: 'css',
  bash: 'bash', sh: 'bash', shell: 'bash',
  md: 'markdown', markdown: 'markdown',
  json: 'json', xml: 'xml', yaml: 'yaml',
};

function highlight(code, language) {
  const lang = LANG_MAP[language] || 'text';
  const hl = HIGHLIGHTERS[lang];
  if (!hl) return escapeHtml(code);
  return hl(escapeHtml(code));
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const LANGUAGE_ICONS = {
  python: '🐍', javascript: '🟨', html: '🌐', css: '🎨', bash: '💻', json: '📋', markdown: '📝',
};

// ── Preview renderers ──
function HtmlPreview({ code }) {
  const iframeRef = useRef(null);
  useEffect(() => {
    if (iframeRef.current) {
      const blob = new Blob([code], { type: 'text/html' });
      iframeRef.current.src = URL.createObjectURL(blob);
    }
  }, [code]);
  return <iframe ref={iframeRef} className="art-preview-iframe" title="HTML Preview" sandbox="allow-scripts" />;
}

function MarkdownPreview({ code }) {
  const html = code
    .replace(/### (.+)/g, '<h3>$1</h3>')
    .replace(/## (.+)/g, '<h2>$1</h2>')
    .replace(/# (.+)/g, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^- (.+)/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank">$1</a>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
  return <div className="art-preview-md" dangerouslySetInnerHTML={{ __html: `<p>${html}</p>` }} />;
}

// ── Simple chart renderer (SVG from data) ──
function ChartPreview({ code }) {
  // Detect if it looks like chart data (JSON with labels/values)
  try {
    const data = JSON.parse(code);
    if (data.labels && data.values) {
      const max = Math.max(...data.values);
      const w = 400, h = 250, barW = Math.max(20, (w - 40) / data.labels.length - 10);
      return <svg viewBox={`0 0 ${w} ${h}`} className="art-chart-svg">
        {data.labels.map((label, i) => {
          const barH = (data.values[i] / max) * 180;
          const x = 30 + i * (barW + 10);
          const y = h - 30 - barH;
          return <g key={i}>
            <rect x={x} y={y} width={barW} height={barH} fill="#00ff88" rx="3" opacity={0.8}>
              <animate attributeName="height" from="0" to={barH} dur="0.3s" fill="freeze" />
              <animate attributeName="y" from={h - 30} to={y} dur="0.3s" fill="freeze" />
            </rect>
            <text x={x + barW / 2} y={h - 12} textAnchor="middle" fill="#aaa" fontSize="10">{label}</text>
            <text x={x + barW / 2} y={y - 6} textAnchor="middle" fill="#00ff88" fontSize="10">{data.values[i]}</text>
          </g>;
        })}
      </svg>;
    }
  } catch {}
  return <div className="art-preview-md"><p>Chart preview: paste JSON with <code>{`{ "labels": [...], "values": [...] }`}</code></p></div>;
}

// ── Main ArtifactPanel ──
const ArtifactPanel = ({ artifacts, onRemove, onRunCode, onClear }) => {
  const [activeId, setActiveId] = useState(artifacts[0]?.id || null);
  const [editMode, setEditMode] = useState({});
  const [editedCode, setEditedCode] = useState({});
  const [copiedId, setCopiedId] = useState(null);
  const [showPanel, setShowPanel] = useState(true);
  const [runOutput, setRunOutput] = useState({});
  const abortRef = useRef(null);

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  // Activate first artifact when new ones arrive
  useEffect(() => {
    if (artifacts.length > 0 && !artifacts.find(a => a.id === activeId)) {
      setActiveId(artifacts[0].id);
    }
  }, [artifacts.length, activeId]);

  const active = artifacts.find(a => a.id === activeId);
  if (!active) return null;

  const toggleEdit = (id) => {
    setEditMode(prev => ({ ...prev, [id]: !prev[id] }));
    if (!editedCode[id]) setEditedCode(prev => ({ ...prev, [id]: active.code }));
  };

  const handleRun = async (id) => {
    const code = editedCode[id] || artifacts.find(a => a.id === id)?.code || '';
    const lang = artifacts.find(a => a.id === id)?.language || 'python';
    setRunOutput(prev => ({ ...prev, [id]: { running: true, lines: [] } }));

    const abortCtrl = new AbortController();
    abortRef.current = abortCtrl;

    try {
      const res = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, language: lang }),
        signal: abortCtrl.signal,
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          if (line.startsWith('data: ')) {
            try {
              const d = JSON.parse(line.slice(6));
              if (d.type === 'stdout' || d.type === 'stderr') {
                setRunOutput(prev => ({ ...prev, [id]: { running: true, lines: [...(prev[id]?.lines || []), { type: d.type, text: d.text }] } }));
              } else if (d.exitCode !== undefined) {
                setRunOutput(prev => ({ ...prev, [id]: { running: false, lines: [...(prev[id]?.lines || [])], exitCode: d.exitCode, duration: d.duration } }));
              }
            } catch {}
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setRunOutput(prev => ({ ...prev, [id]: { running: false, lines: [...(prev[id]?.lines || []), { type: 'stderr', text: `Error: ${err.message}` }] } }));
      }
    }
  };

  const handleCopy = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedId(activeId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {}
  };

  const previewMode = active.type === 'preview' || (active.language === 'html' || active.language === 'md' || active.language === 'markdown');

  const renderPreview = () => {
    const lang = active.language;
    if (lang === 'html') return <HtmlPreview code={editedCode[active.id] || active.code} />;
    if (lang === 'md' || lang === 'markdown') return <MarkdownPreview code={editedCode[active.id] || active.code} />;
    if (lang === 'json') return <ChartPreview code={editedCode[active.id] || active.code} />;
    return null;
  };

  return (
    <div className={`art-panel ${showPanel ? 'open' : ''}`}>
      <div className="art-panel-header">
        <div className="art-panel-title">
          <FileCode size={16} />
          <span>Artifacts ({artifacts.length})</span>
        </div>
        <div className="art-panel-actions">
          <button className="art-btn-icon" onClick={onClear} title="Clear all"><X size={14} /></button>
        </div>
      </div>

      {/* Tabs */}
      <div className="art-tabs">
        {artifacts.map(art => (
          <button
            key={art.id}
            className={`art-tab ${art.id === activeId ? 'active' : ''}`}
            onClick={() => setActiveId(art.id)}
          >
            <span className="art-tab-icon">{LANGUAGE_ICONS[art.language] || '📄'}</span>
            <span className="art-tab-label">{art.title}</span>
            <span className="art-tab-close" onClick={(e) => { e.stopPropagation(); onRemove(art.id); }}>&times;</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="art-content">
        <div className="art-toolbar">
          <span className="art-lang-badge">{active.language}</span>
          <div className="art-toolbar-actions">
            {previewMode && (
              <button className={`art-btn ${editMode[active.id] ? '' : 'active'}`} onClick={() => setEditMode(prev => ({ ...prev, [active.id]: false }))}>
                <Eye size={14} /> Preview
              </button>
            )}
            <button className={`art-btn ${editMode[active.id] ? 'active' : ''}`} onClick={() => toggleEdit(active.id)}>
              <Edit3 size={14} /> Edit
            </button>
            <button className="art-btn" onClick={() => handleCopy(editedCode[active.id] || active.code)}>
              {copiedId === active.id ? <Check size={14} /> : <Copy size={14} />} Copy
            </button>
            <button className="art-btn run-btn" onClick={() => handleRun(active.id)} disabled={runOutput[active.id]?.running}>
              <Play size={14} /> Run
            </button>
          </div>
        </div>

        <div className="art-body">
          {editMode[active.id] && !previewMode ? (
            <textarea
              className="art-editor"
              value={editedCode[active.id] ?? active.code}
              onChange={(e) => setEditedCode(prev => ({ ...prev, [active.id]: e.target.value }))}
              spellCheck={false}
            />
          ) : previewMode && !editMode[active.id] ? (
            <div className="art-preview">
              <div className="art-preview-header">
                <Terminal size={12} /> <span>Preview</span>
              </div>
              {renderPreview()}
            </div>
          ) : (
            <div
              className="art-code"
              dangerouslySetInnerHTML={{ __html: highlight(editedCode[active.id] ?? active.code, active.language) }}
            />
          )}
        </div>

        {/* Output */}
        {runOutput[active.id] && (
          <div className="art-output">
            <div className="art-output-header">
              <Terminal size={12} /> <span>Output</span>
              {runOutput[active.id].exitCode !== undefined && (
                <span className={`art-exit-code ${runOutput[active.id].exitCode === 0 ? 'success' : 'error'}`}>
                  {runOutput[active.id].exitCode === 0 ? 'Success' : `Exit ${runOutput[active.id].exitCode}`}
                  {' '}({(runOutput[active.id].duration / 1000).toFixed(2)}s)
                </span>
              )}
            </div>
            <div className="art-output-body">
              {runOutput[active.id].lines.map((line, i) => (
                <div key={i} className={`art-out-line ${line.type}`}>{line.text}</div>
              ))}
              {runOutput[active.id].running && <div className="art-out-line system">Running...</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ArtifactPanel;

// @ts-nocheck
import { useState, useEffect } from 'react';
import { Languages, ArrowRightLeft, Loader, AlertCircle, Copy, Check } from 'lucide-react';
import './TranslationPanel.css';

const DETECT_LANG = { code: 'auto', name: 'Detect Language' };

export default function TranslationPanel({ onSwitchToNexus }) {
  const [languages, setLanguages] = useState([]);
  const [sourceLang, setSourceLang] = useState('auto');
  const [targetLang, setTargetLang] = useState('hi');
  const [text, setText] = useState('');
  const [translated, setTranslated] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/api/translate/languages')
      .then(r => r.json())
      .then(d => { if (d.ok) setLanguages(d.languages); })
      .catch(() => {});
  }, []);

  const handleTranslate = async () => {
    if (!text.trim()) return;
    setLoading(true); setError(null); setTranslated('');
    try {
      const r = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim(), sourceLang, targetLang }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      setTranslated(d.translated);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const handleSwap = () => {
    if (sourceLang === 'auto') return;
    setSourceLang(targetLang);
    setTargetLang(sourceLang);
    setText(translated);
    setTranslated('');
  };

  const handleCopy = () => {
    if (!translated) return;
    navigator.clipboard.writeText(translated);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleKeyDown = (e) => { if (e.key === 'Enter') handleTranslate(); };

  const langOptions = [DETECT_LANG, ...languages];

  return (
    <div className="translation-panel">
      <div className="trans-header">
        <h2><Languages size={20} /> Translator</h2>
        <button className="trans-back-btn" onClick={onSwitchToNexus}>Back to Nexus</button>
      </div>

      <div className="trans-body">
        <div className="trans-controls">
          <div className="trans-lang-selectors">
            <select className="trans-select" value={sourceLang} onChange={e => setSourceLang(e.target.value)}>
              {langOptions.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
            <button className="trans-swap-btn" onClick={handleSwap} disabled={sourceLang === 'auto'} title="Swap languages">
              <ArrowRightLeft size={16} />
            </button>
            <select className="trans-select" value={targetLang} onChange={e => setTargetLang(e.target.value)}>
              {languages.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
          </div>
        </div>

        <div className="trans-panels">
          <div className="trans-panel">
            <div className="trans-panel-header">
              <span>{langOptions.find(l => l.code === sourceLang)?.name || 'Source'}</span>
              <span className="trans-char-count">{text.length} chars</span>
            </div>
            <textarea
              className="trans-textarea"
              placeholder="Enter text to translate..."
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={6}
            />
          </div>

          <div className="trans-panel">
            <div className="trans-panel-header">
              <span>{languages.find(l => l.code === targetLang)?.name || 'Target'}</span>
              <div className="trans-panel-actions">
                {translated && (
                  <button className="trans-icon-btn" onClick={handleCopy} title="Copy translation">
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                )}
              </div>
            </div>
            <div className="trans-result">
              {loading ? (
                <div className="trans-loading"><Loader size={20} className="spin" /> Translating...</div>
              ) : translated ? (
                <div className="trans-result-text">{translated}</div>
              ) : (
                <div className="trans-placeholder">Translation will appear here</div>
              )}
            </div>
          </div>
        </div>

        {error && <div className="trans-error"><AlertCircle size={14} /> {error}</div>}

        <div className="trans-actions">
          <button className="trans-translate-btn" onClick={handleTranslate} disabled={loading || !text.trim()}>
            {loading ? <><Loader size={16} className="spin" /> Translating...</> : <><Languages size={16} /> Translate</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// @ts-nocheck
import { useState, useEffect, useRef } from 'react';
import { Mic, Volume2, Loader, AlertCircle, Search, Check, Play, Save } from 'lucide-react';
import './VoiceLab.css';

export default function VoiceLab({ onSwitchToNexus }) {
  const [voices, setVoices] = useState([]);
  const [filteredVoices, setFilteredVoices] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedVoice, setSelectedVoice] = useState(null);
  const [previewText, setPreviewText] = useState('Namaste! Main aapki digital assistant hoon.');
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [groupBy, setGroupBy] = useState('lang');
  const audioRef = useRef(null);

  useEffect(() => {
    fetch('/api/tts/voices')
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setVoices(d.voices || []);
          setFilteredVoices(d.voices || []);
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!search.trim()) {
      setFilteredVoices(voices);
      return;
    }
    const q = search.toLowerCase();
    setFilteredVoices(voices.filter(v =>
      v.name.toLowerCase().includes(q) ||
      v.locale?.toLowerCase().includes(q) ||
      v.gender?.toLowerCase().includes(q) ||
      v.lang?.toLowerCase().includes(q)
    ));
  }, [search, voices]);

  const handlePreview = async (voice) => {
    setPlaying(true); setError(null);
    try {
      const r = await fetch('/api/tts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: voice.name, text: previewText }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      const blob = base64ToBlob(d.audioBase64, d.audioMimeType);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { setPlaying(false); URL.revokeObjectURL(url); };
      audio.onerror = () => { setPlaying(false); setError('Playback failed'); };
      audio.play();
    } catch (e) { setError(e.message); setPlaying(false); }
  };

  const base64ToBlob = (b64, mime) => {
    const byteChars = atob(b64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'audio/mpeg' });
  };

  const groupedVoices = {};
  if (groupBy === 'lang') {
    filteredVoices.forEach(v => {
      const key = v.locale || v.lang || 'other';
      if (!groupedVoices[key]) groupedVoices[key] = [];
      groupedVoices[key].push(v);
    });
  } else if (groupBy === 'gender') {
    filteredVoices.forEach(v => {
      const key = v.gender || 'Unknown';
      if (!groupedVoices[key]) groupedVoices[key] = [];
      groupedVoices[key].push(v);
    });
  }

  return (
    <div className="voice-lab">
      <div className="voice-lab-header">
        <h2><Volume2 size={20} /> Voice Lab</h2>
        <span className="voice-lab-count">{voices.length} voices</span>
        <button className="voice-lab-back-btn" onClick={onSwitchToNexus}>Back to Nexus</button>
      </div>

      <div className="voice-lab-toolbar">
        <div className="voice-lab-search-wrap">
          <Search size={14} className="voice-lab-search-icon" />
          <input className="voice-lab-search" placeholder="Search voices..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="voice-lab-group-select">
          <button className={`voice-lab-group-btn ${groupBy === 'lang' ? 'active' : ''}`} onClick={() => setGroupBy('lang')}>By Language</button>
          <button className={`voice-lab-group-btn ${groupBy === 'gender' ? 'active' : ''}`} onClick={() => setGroupBy('gender')}>By Gender</button>
        </div>
        <div className="voice-lab-preview-config">
          <input className="voice-lab-preview-input" placeholder="Preview text..." value={previewText} onChange={e => setPreviewText(e.target.value)} />
        </div>
      </div>

      {error && <div className="voice-lab-error"><AlertCircle size={14} /> {error}</div>}

      <div className="voice-lab-body">
        {loading && <div className="voice-lab-loading"><Loader size={24} className="spin" /> Loading voices...</div>}

        {!loading && Object.entries(groupedVoices).map(([group, voiceList]) => (
          <div key={group} className="voice-lab-group">
            <h3 className="voice-lab-group-title">{group} ({voiceList.length})</h3>
            <div className="voice-lab-list">
              {voiceList.map((v, i) => (
                <div key={i} className={`voice-lab-item ${selectedVoice?.name === v.name ? 'selected' : ''}`} onClick={() => setSelectedVoice(v)}>
                  <div className="voice-lab-item-info">
                    <div className="voice-lab-item-name">{v.name}</div>
                    <div className="voice-lab-item-meta">{v.locale} · {v.gender}</div>
                  </div>
                  <button className="voice-lab-play-btn" onClick={(e) => { e.stopPropagation(); handlePreview(v); }} disabled={playing} title="Preview voice">
                    {playing && selectedVoice?.name === v.name ? <Loader size={14} className="spin" /> : <Play size={14} />}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}

        {!loading && filteredVoices.length === 0 && (
          <div className="voice-lab-empty">No voices match your search</div>
        )}
      </div>
    </div>
  );
}

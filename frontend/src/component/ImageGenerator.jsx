import { useState } from 'react';
import { Image, Loader, AlertCircle, Download, RefreshCw, Sparkles } from 'lucide-react';
import './ImageGenerator.css';

export default function ImageGenerator({ onSwitchToNexus }) {
  const [prompt, setPrompt] = useState('');
  const [imageData, setImageData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [enhancedPrompt, setEnhancedPrompt] = useState('');

  const handleGenerate = async (useEnhanced) => {
    const text = useEnhanced && enhancedPrompt ? enhancedPrompt : prompt;
    if (!text.trim()) return;
    setLoading(true); setError(null); setImageData(null);
    try {
      const r = await fetch('/api/image/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text.trim() }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      setImageData(d);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const handleEnhance = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Enhance this image prompt to be more detailed and descriptive for AI image generation. Return ONLY the enhanced prompt, nothing else: "${prompt}"`,
          voiceMode: 'female',
          speakingRate: 'normal',
        }),
      });
      const d = await r.json();
      if (d.text) {
        const cleaned = d.text.replace(/^["']|["']$/g, '').trim();
        setEnhancedPrompt(cleaned);
      }
    } catch {}
    finally { setLoading(false); }
  };

  const handleDownload = () => {
    if (!imageData) return;
    const a = document.createElement('a');
    a.href = `data:${imageData.mimeType};base64,${imageData.data}`;
    a.download = `nexus-image-${Date.now()}.jpg`;
    a.click();
  };

  const handleKeyDown = (e) => { if (e.key === 'Enter') handleGenerate(false); };

  return (
    <div className="image-generator">
      <div className="img-gen-header">
        <h2><Image size={20} /> Image Generator</h2>
        <div className="img-gen-badges">
          <span className="img-gen-badge">AI</span>
          <span className="img-gen-badge">Stable Diffusion</span>
        </div>
        <button className="img-gen-back-btn" onClick={onSwitchToNexus}>Back to Nexus</button>
      </div>

      <div className="img-gen-body">
        <div className="img-gen-input-area">
          <div className="img-gen-input-wrap">
            <Sparkles size={16} className="img-gen-input-icon" />
            <input
              className="img-gen-input"
              placeholder="Describe the image you want to create..."
              value={prompt}
              onChange={e => { setPrompt(e.target.value); setEnhancedPrompt(''); }}
              onKeyDown={handleKeyDown}
            />
          </div>
          <div className="img-gen-actions">
            <button className="img-gen-btn primary" onClick={() => handleGenerate(false)} disabled={loading || !prompt.trim()}>
              {loading ? <Loader size={16} className="spin" /> : <Image size={16} />}
              {loading ? 'Generating...' : 'Generate'}
            </button>
            <button className="img-gen-btn secondary" onClick={handleEnhance} disabled={loading || !prompt.trim()}>
              <Sparkles size={16} /> Enhance Prompt
            </button>
          </div>
          {enhancedPrompt && (
            <div className="img-gen-enhanced">
              <div className="img-gen-enhanced-label">Enhanced Prompt:</div>
              <div className="img-gen-enhanced-text">{enhancedPrompt}</div>
              <button className="img-gen-btn primary small" onClick={() => handleGenerate(true)}>
                Generate with Enhanced
              </button>
            </div>
          )}
        </div>

        {error && <div className="img-gen-error"><AlertCircle size={14} /> {error}</div>}

        <div className="img-gen-output">
          {loading && (
            <div className="img-gen-loading">
              <Loader size={32} className="spin" />
              <p>Creating your image...</p>
            </div>
          )}
          {imageData && !loading && (
            <div className="img-gen-result">
              <div className="img-gen-image-wrap">
                <img
                  src={`data:${imageData.mimeType};base64,${imageData.data}`}
                  alt={imageData.prompt}
                  className="img-gen-image"
                />
              </div>
              <div className="img-gen-meta">
                <span>Prompt: {imageData.prompt}</span>
                <span>Size: {imageData.width}x{imageData.height}</span>
                <button className="img-gen-download-btn" onClick={handleDownload}>
                  <Download size={14} /> Download
                </button>
              </div>
            </div>
          )}
          {!imageData && !loading && !error && (
            <div className="img-gen-placeholder">
              <Image size={64} />
              <p>Enter a prompt above to generate an image</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

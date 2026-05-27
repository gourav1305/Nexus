import React, { useState, useRef, useEffect } from 'react';
import { Terminal, Play, RotateCw, FileCode, Trash2, Download } from 'lucide-react';
import './CodeSandbox.css';

const SNIPPETS = {
  python: `# Hello in Python
name = "NEXUS"
print(f"Hello from {name}!")
for i in range(5):
    print(f"Count: {i}")`,
  javascript: `// Hello in Node.js
const name = "NEXUS";
console.log(\`Hello from \${name}!\`);
for (let i = 0; i < 5; i++) {
  console.log(\`Count: \${i}\`);
}`,
  bash: `#!/bin/bash
echo "Hello from NEXUS!"
for i in {1..5}; do
  echo "Count: $i"
done`,
};

const CodeSandbox = ({ onSwitchToNexus }) => {
  const [code, setCode] = useState(SNIPPETS.python);
  const [language, setLanguage] = useState('python');
  const [output, setOutput] = useState([]);
  const [running, setRunning] = useState(false);
  const [exitCode, setExitCode] = useState(null);
  const outputRef = useRef(null);
  const eventSourceRef = useRef(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
    };
  }, []);

  const handleLanguageChange = (lang) => {
    // Keep current code if switching unless current code matches previous snippet
    setLanguage(lang);
    setOutput([]);
    setExitCode(null);
  };

  const loadSnippet = (lang) => {
    setCode(SNIPPETS[lang]);
    setLanguage(lang);
    setOutput([]);
    setExitCode(null);
  };

  const handleRun = async () => {
    if (!code.trim()) return;
    setRunning(true);
    setOutput([{ type: 'system', text: `\u2514 Running ${language}...` }]);
    setExitCode(null);

    try {
      const res = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, language }),
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          if (line.startsWith('event: ')) {
            const eventType = line.slice(7).trim();
            continue;
          }
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'stdout' || data.type === 'stderr') {
                setOutput(prev => [...prev, { type: data.type, text: data.text }]);
              } else if (data.type === 'system') {
                setOutput(prev => [...prev, { type: 'system', text: data.text }]);
              } else if (data.exitCode !== undefined) {
                setExitCode(data.exitCode);
                if (data.error) {
                  setOutput(prev => [...prev, { type: 'error', text: data.error }]);
                }
                if (data.truncated) {
                  setOutput(prev => [...prev, { type: 'warn', text: '! Output truncated (512KB limit)' }]);
                }
                setOutput(prev => [...prev, {
                  type: 'system',
                  text: `\u2514 Process exited with code ${data.exitCode ?? 'N/A'} in ${(data.duration / 1000).toFixed(2)}s`
                }]);
              }
            } catch {}
          }
        }
      }

      // Parse any remaining buffer
      if (buffer.startsWith('data: ')) {
        try {
          const data = JSON.parse(buffer.slice(6));
          if (data.exitCode !== undefined) {
            setExitCode(data.exitCode);
          }
        } catch {}
      }
    } catch (err) {
      setOutput(prev => [...prev, { type: 'error', text: `Connection error: ${err.message}` }]);
    } finally {
      setRunning(false);
    }
  };

  const handleClear = () => {
    setOutput([]);
    setExitCode(null);
  };

  const handleDownload = () => {
    const ext = { python: 'py', javascript: 'js', bash: 'sh' }[language] || 'txt';
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nexus-code.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exitColor = exitCode === 0 ? '#00ff88' : exitCode !== null ? '#ff4466' : '#888';

  return (
    <div className="codesandbox-container">
      <div className="codesandbox-header">
        <div className="cs-header-left">
          <Terminal size={22} className="cs-icon" />
          <h2>Code Sandbox</h2>
        </div>
        <div className="cs-header-right">
          <button className="cs-btn secondary" onClick={handleDownload} title="Download code">
            <Download size={16} />
          </button>
          <button className="cs-btn secondary" onClick={handleClear} title="Clear output">
            <Trash2 size={16} />
          </button>
          <button className="cs-btn secondary" onClick={() => loadSnippet(language)} title="Load snippet">
            <FileCode size={16} />
          </button>
          <button className="cs-btn primary" onClick={handleRun} disabled={running}>
            {running ? <RotateCw size={16} className="spin" /> : <Play size={16} />}
            {running ? 'Running...' : 'Run'}
          </button>
          <button className="cs-btn ghost" onClick={onSwitchToNexus}>Back to Nexus</button>
        </div>
      </div>

      <div className="cs-main">
        <div className="cs-editor-pane">
          <div className="cs-editor-toolbar">
            <div className="cs-lang-select">
              {['python', 'javascript', 'bash'].map(lang => (
                <button
                  key={lang}
                  className={`cs-lang-btn ${language === lang ? 'active' : ''}`}
                  onClick={() => handleLanguageChange(lang)}
                >
                  {lang === 'javascript' ? 'Node.js' : lang.charAt(0).toUpperCase() + lang.slice(1)}
                </button>
              ))}
            </div>
            <span className="cs-chars">{code.length} chars</span>
          </div>
          <textarea
            className="cs-editor"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
            placeholder="Write your code here..."
          />
        </div>

        <div className="cs-output-pane">
          <div className="cs-output-header">
            <Terminal size={14} />
            <span>Output</span>
            {exitCode !== null && (
              <span className="cs-exit-code" style={{ color: exitColor }}>
                {exitCode === 0 ? 'Success' : `Exit: ${exitCode}`}
              </span>
            )}
          </div>
          <div className="cs-output" ref={outputRef}>
            {output.length === 0 && (
              <div className="cs-output-empty">
                Press <strong>Run</strong> to execute your code
              </div>
            )}
            {output.map((line, i) => (
              <div key={i} className={`cs-line cs-line-${line.type}`}>
                {line.text}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CodeSandbox;

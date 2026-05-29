import { useState } from 'react';
import { Mail, Send, Inbox, Settings, RefreshCw, AlertCircle, Check } from 'lucide-react';
import './EmailClient.css';

const API = '/api/email';

export default function EmailClient({ onSwitchToNexus }) {
  const [tab, setTab] = useState('compose'); // compose | inbox | settings
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Compose state
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  // Inbox state
  const [emails, setEmails] = useState([]);
  const [selectedEmail, setSelectedEmail] = useState(null);

  // Config state
  const [config, setConfig] = useState({ smtp: { host: 'smtp.gmail.com', port: 587, user: '', pass: '' }, imap: { host: 'imap.gmail.com', port: 993, user: '', pass: '' } });

  const showError = (msg) => { setError(msg); setTimeout(() => setError(null), 4000); };
  const showSuccess = (msg) => { setSuccess(msg); setTimeout(() => setSuccess(null), 3000); };

  const handleSend = async () => {
    if (!to || !subject || !body) { showError('To, Subject, and Body are required'); return; }
    setLoading(true); setError(null);
    try {
      const r = await fetch(`${API}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, subject, text: body }) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      showSuccess('Email sent successfully!');
      setTo(''); setSubject(''); setBody('');
    } catch (e) { showError(e.message); }
    finally { setLoading(false); }
  };

  const handleReadEmails = async () => {
    setLoading(true); setError(null); setSelectedEmail(null);
    try {
      const r = await fetch(`${API}/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 15 }) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      setEmails(d.emails || []);
      if (d.emails.length === 0) showSuccess('No emails found');
    } catch (e) { showError(e.message); }
    finally { setLoading(false); }
  };

  const handleLoadConfig = async () => {
    try {
      const r = await fetch(`${API}/config`);
      const d = await r.json();
      if (d.ok) setConfig(prev => ({ ...prev, ...d.config }));
    } catch {}
  };

  const handleSaveConfig = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`${API}/config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      showSuccess('Email settings saved');
    } catch (e) { showError(e.message); }
    finally { setLoading(false); }
  };

  const formatDate = (d) => {
    if (!d) return '';
    const date = new Date(d);
    return date.toLocaleString();
  };

  return (
    <div className="email-client">
      <div className="email-header">
        <h2><Mail size={20} /> Email</h2>
        <div className="email-tabs">
          <button className={`email-tab ${tab === 'compose' ? 'active' : ''}`} onClick={() => setTab('compose')}><Send size={14} /> Compose</button>
          <button className={`email-tab ${tab === 'inbox' ? 'active' : ''}`} onClick={() => { setTab('inbox'); handleReadEmails(); }}><Inbox size={14} /> Inbox</button>
          <button className={`email-tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => { setTab('settings'); handleLoadConfig(); }}><Settings size={14} /> Settings</button>
        </div>
        <button className="email-back-btn" onClick={onSwitchToNexus}>Back to Nexus</button>
      </div>

      {error && <div className="email-toast error"><AlertCircle size={14} /> {error}</div>}
      {success && <div className="email-toast success"><Check size={14} /> {success}</div>}

      <div className="email-body">
        {tab === 'compose' && (
          <div className="email-compose">
            <input className="email-input" placeholder="To (email address)" value={to} onChange={e => setTo(e.target.value)} />
            <input className="email-input" placeholder="Subject" value={subject} onChange={e => setSubject(e.target.value)} />
            <textarea className="email-textarea" placeholder="Write your message..." value={body} onChange={e => setBody(e.target.value)} rows={12} />
            <button className="email-send-btn" onClick={handleSend} disabled={loading}>
              {loading ? 'Sending...' : <><Send size={14} /> Send Email</>}
            </button>
          </div>
        )}

        {tab === 'inbox' && (
          <div className="email-inbox">
            <div className="email-inbox-toolbar">
              <span>{emails.length} emails</span>
              <button className="email-refresh-btn" onClick={handleReadEmails} disabled={loading}>
                <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
              </button>
            </div>
            {emails.length === 0 && !loading && <div className="email-empty">No emails loaded. Click Refresh.</div>}
            {loading && <div className="email-empty">Loading emails...</div>}
            <div className="email-list">
              {emails.map((email, i) => (
                <div key={i} className={`email-item ${selectedEmail === i ? 'selected' : ''}`} onClick={() => setSelectedEmail(selectedEmail === i ? null : i)}>
                  <div className="email-item-from">{email.from || '(unknown)'}</div>
                  <div className="email-item-subject">{email.subject || '(no subject)'}</div>
                  <div className="email-item-date">{formatDate(email.date)}</div>
                  {selectedEmail === i && email.text && (
                    <div className="email-item-body">{email.text}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'settings' && (
          <div className="email-settings">
            <h3>SMTP Settings (Send)</h3>
            <input className="email-input" placeholder="SMTP Host" value={config.smtp?.host || 'smtp.gmail.com'} onChange={e => setConfig({ ...config, smtp: { ...config.smtp, host: e.target.value } })} />
            <input className="email-input" placeholder="SMTP Port" type="number" value={config.smtp?.port || 587} onChange={e => setConfig({ ...config, smtp: { ...config.smtp, port: parseInt(e.target.value) } })} />
            <input className="email-input" placeholder="SMTP Username (email)" value={config.smtp?.user || ''} onChange={e => setConfig({ ...config, smtp: { ...config.smtp, user: e.target.value } })} />
            <input className="email-input" placeholder="SMTP Password" type="password" value={config.smtp?.pass || ''} onChange={e => setConfig({ ...config, smtp: { ...config.smtp, pass: e.target.value } })} />
            <h3>IMAP Settings (Read)</h3>
            <input className="email-input" placeholder="IMAP Host" value={config.imap?.host || 'imap.gmail.com'} onChange={e => setConfig({ ...config, imap: { ...config.imap, host: e.target.value } })} />
            <input className="email-input" placeholder="IMAP Port" type="number" value={config.imap?.port || 993} onChange={e => setConfig({ ...config, imap: { ...config.imap, port: parseInt(e.target.value) } })} />
            <input className="email-input" placeholder="IMAP Username (email)" value={config.imap?.user || ''} onChange={e => setConfig({ ...config, imap: { ...config.imap, user: e.target.value } })} />
            <input className="email-input" placeholder="IMAP Password" type="password" value={config.imap?.pass || ''} onChange={e => setConfig({ ...config, imap: { ...config.imap, pass: e.target.value } })} />
            <button className="email-send-btn" onClick={handleSaveConfig} disabled={loading}>Save Settings</button>
          </div>
        )}
      </div>
    </div>
  );
}

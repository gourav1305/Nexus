import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, Zap, Clock, FileText, Webhook, Mail, MessageSquare,
  Terminal, Globe, Palette, Trash2, Copy, Check, Power,
  ToggleLeft, ToggleRight, History, X, ExternalLink,
} from 'lucide-react';
import './Recipes.css';

const TRIGGER_TYPES = [
  { id: 'time', label: 'Time', icon: Clock, desc: 'Schedule-based (interval, daily, hourly)' },
  { id: 'file', label: 'File Change', icon: FileText, desc: 'Watch file or folder for changes' },
  { id: 'webhook', label: 'Webhook', icon: Webhook, desc: 'External HTTP POST trigger' },
  { id: 'email', label: 'Email', icon: Mail, desc: 'Trigger on new email' },
];

const ACTION_TYPES = [
  { id: 'message', label: 'Send Message', icon: MessageSquare, desc: 'Post a message to NEXUS chat' },
  { id: 'command', label: 'Run Command', icon: Terminal, desc: 'Execute a system command' },
  { id: 'api', label: 'Call API', icon: Globe, desc: 'Make an HTTP request' },
  { id: 'blob', label: 'Blob Effect', icon: Palette, desc: 'Change blob color/appearance' },
];

const TIME_SCHEDULES = [
  { id: 'interval:60000', label: 'Every 1 minute' },
  { id: 'interval:300000', label: 'Every 5 minutes' },
  { id: 'interval:600000', label: 'Every 10 minutes' },
  { id: 'interval:1800000', label: 'Every 30 minutes' },
  { id: 'interval:3600000', label: 'Every 1 hour' },
  { id: 'daily:09:00', label: 'Daily at 9:00 AM' },
  { id: 'daily:12:00', label: 'Daily at 12:00 PM' },
  { id: 'daily:18:00', label: 'Daily at 6:00 PM' },
  { id: 'daily:21:00', label: 'Daily at 9:00 PM' },
  { id: 'hourly:00', label: 'Every hour at :00' },
  { id: 'hourly:30', label: 'Every hour at :30' },
];

const FILE_EVENTS = [
  { id: 'change', label: 'Any change' },
  { id: 'rename', label: 'Rename' },
  { id: 'all', label: 'All events' },
];

const EMPTY_RECIPE = {
  name: '',
  description: '',
  trigger: { type: 'time', config: { schedule: 'interval:60000' } },
  action: { type: 'message', config: { text: 'Recipe "{{recipeName}}" triggered at {{time}}' } },
};

function parseSchedule(scheduleId) {
  if (!scheduleId) return { type: 'interval', intervalMs: 60000 };
  const [kind, ...rest] = scheduleId.split(':');
  if (kind === 'interval') return { type: 'interval', intervalMs: parseInt(rest[0]) || 60000 };
  if (kind === 'daily') {
    const [h, m] = (rest.join(':') || '09:00').split(':').map(Number);
    return { type: 'daily', time: `${String(h||9).padStart(2,'0')}:${String(m||0).padStart(2,'0')}` };
  }
  if (kind === 'hourly') return { type: 'hourly', minute: rest[0] || '0' };
  return { type: 'interval', intervalMs: 60000 };
}

function configToScheduleId(config) {
  if (!config) return 'interval:60000';
  if (config.type === 'daily') return `daily:${config.time || '09:00'}`;
  if (config.type === 'hourly') return `hourly:${config.minute || '00'}`;
  return `interval:${config.intervalMs || 60000}`;
}

const Recipes = ({ onSwitchToNexus, token }) => {
  const authHeaders = token ? { 'Authorization': `Bearer ${token}` } : {};
  const [recipes, setRecipes] = useState([]);
  const [logEntries, setLogEntries] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_RECIPE, trigger: { type: 'time', config: { schedule: 'interval:60000' } }, action: { type: 'message', config: { text: '' } } });
  const [copiedId, setCopiedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const fetchRecipes = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/recipes', { headers: authHeaders });
      const data = await res.json();
      if (data.ok) setRecipes(data.recipes);
    } catch (e) {
      console.error('Failed to fetch recipes:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLog = useCallback(async () => {
    try {
      const res = await fetch('/api/recipes/log/all');
      const data = await res.json();
      if (data.ok) setLogEntries(data.entries || []);
    } catch {}
  }, []);

  useEffect(() => { fetchRecipes(); fetchLog(); }, [fetchRecipes, fetchLog]);

  const handleToggle = async (id) => {
    try {
      await fetch(`/api/auth/recipes/${id}/toggle`, { method: 'POST', headers: authHeaders });
      fetchRecipes();
    } catch { showToast('Toggle failed'); }
  };

  const handleDelete = async (id) => {
    try {
      await fetch(`/api/auth/recipes/${id}`, { method: 'DELETE', headers: authHeaders });
      fetchRecipes();
      showToast('Recipe deleted');
    } catch { showToast('Delete failed'); }
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({
      name: '',
      description: '',
      trigger: { type: 'time', config: { schedule: 'interval:60000' } },
      action: { type: 'message', config: { text: '' } },
    });
    setShowForm(true);
  };

  const openEdit = (recipe) => {
    setEditingId(recipe.id);
    const triggerConfig = recipe.trigger.type === 'time'
      ? { schedule: configToScheduleId(recipe.trigger.config) }
      : { ...recipe.trigger.config, password: undefined };
    setForm({
      name: recipe.name,
      description: recipe.description || '',
      trigger: { type: recipe.trigger.type, config: triggerConfig },
      action: { type: recipe.action.type, config: { ...recipe.action.config } },
    });
    setShowForm(true);
  };

  const handleFormChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleTriggerTypeChange = (type) => {
    const defaults = {
      time: { schedule: 'interval:60000' },
      file: { path: '', event: 'change' },
      webhook: {},
      email: { host: '', username: '', password: '', folder: 'INBOX' },
    };
    setForm(prev => ({
      ...prev,
      trigger: { type, config: defaults[type] || {} },
    }));
  };

  const handleTriggerConfig = (key, value) => {
    setForm(prev => ({
      ...prev,
      trigger: { ...prev.trigger, config: { ...prev.trigger.config, [key]: value } },
    }));
  };

  const handleActionTypeChange = (type) => {
    const defaults = {
      message: { text: 'Recipe "{{recipeName}}" triggered at {{time}}' },
      command: { command: '' },
      api: { url: '', method: 'GET', headers: {} },
      blob: { color: '#aa3bff', size: '0.5', duration: 5000 },
    };
    setForm(prev => ({
      ...prev,
      action: { type, config: defaults[type] || {} },
    }));
  };

  const handleActionConfig = (key, value) => {
    setForm(prev => ({
      ...prev,
      action: { ...prev.action, config: { ...prev.action.config, [key]: value } },
    }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) { showToast('Recipe name required'); return; }

    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      trigger: { ...form.trigger },
      action: { ...form.action },
    };

    if (payload.trigger.type === 'time') {
      const parsed = parseSchedule(payload.trigger.config.schedule);
      payload.trigger.config = parsed;
    }

    try {
      if (editingId) {
        await fetch(`/api/auth/recipes/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify(payload),
        });
        showToast('Recipe updated');
      } else {
        await fetch('/api/auth/recipes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify(payload),
        });
        showToast('Recipe created');
      }
      setShowForm(false);
      fetchRecipes();
      fetchLog();
    } catch { showToast('Save failed'); }
  };

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getTriggerIcon = (type) => {
    const t = TRIGGER_TYPES.find(x => x.id === type);
    return t ? <t.icon size={16} /> : <Zap size={16} />;
  };

  const getActionIcon = (type) => {
    const t = ACTION_TYPES.find(x => x.id === type);
    return t ? <t.icon size={16} /> : <MessageSquare size={16} />;
  };

  const getTriggerLabel = (recipe) => {
    const t = recipe.trigger;
    if (t.type === 'time') {
      const s = configToScheduleId(t.config);
      const found = TIME_SCHEDULES.find(x => x.id === s);
      return found ? found.label : `Every ${(t.config.intervalMs || 60000) / 1000}s`;
    }
    if (t.type === 'file') return t.config.path || 'No path';
    if (t.type === 'webhook') return 'POST → webhook';
    if (t.type === 'email') return t.config.username || 'Email';
    return t.type;
  };

  const getActionLabel = (recipe) => {
    const a = recipe.action;
    if (a.type === 'message') return (a.config.text || '').slice(0, 40);
    if (a.type === 'command') return (a.config.command || '').slice(0, 30);
    if (a.type === 'api') return (a.config.url || '').slice(0, 30);
    if (a.type === 'blob') return a.config.color || '#aa3bff';
    return a.type;
  };

  const formatTime = (ts) => {
    if (!ts) return 'Never';
    return new Date(ts).toLocaleString();
  };

  const baseUrl = window.location.origin;

  if (loading) {
    return (
      <div className="recipes-wrapper">
        <div className="recipes-loading">Loading recipes...</div>
      </div>
    );
  }

  return (
    <div className="recipes-wrapper">
      {toast && <div className="recipes-toast">{toast}</div>}

      <div className="recipes-header">
        <div className="recipes-title-section">
          <Zap size={28} className="recipes-title-icon" />
          <h2 className="recipes-title">Automation Recipes</h2>
          <span className="recipes-count">{recipes.length} active</span>
        </div>
        <button className="recipes-create-btn" onClick={openCreate}>
          <Plus size={18} /> New Recipe
        </button>
      </div>

      <div className="recipes-layout">
        <div className="recipes-main">
          {recipes.length === 0 ? (
            <div className="recipes-empty">
              <Zap size={48} className="recipes-empty-icon" />
              <p>No recipes yet</p>
              <span>Create your first automation recipe to get started</span>
            </div>
          ) : (
            <div className="recipes-grid">
              {recipes.map(recipe => (
                <div key={recipe.id} className={`recipe-card ${!recipe.enabled ? 'disabled' : ''}`}>
                  <div className="recipe-card-header">
                    <div className="recipe-card-title">
                      <span className="recipe-name">{recipe.name}</span>
                      {recipe.description && (
                        <span className="recipe-desc">{recipe.description}</span>
                      )}
                    </div>
                    <button
                      className={`recipe-toggle ${recipe.enabled ? 'on' : ''}`}
                      onClick={() => handleToggle(recipe.id)}
                      title={recipe.enabled ? 'Disable' : 'Enable'}
                    >
                      {recipe.enabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                    </button>
                  </div>

                  <div className="recipe-card-body">
                    <div className="recipe-meta-row">
                      <div className="recipe-meta-item" title="Trigger">
                        {getTriggerIcon(recipe.trigger.type)}
                        <span className="recipe-meta-label">{TRIGGER_TYPES.find(t => t.id === recipe.trigger.type)?.label || recipe.trigger.type}</span>
                        <span className="recipe-meta-value">{getTriggerLabel(recipe)}</span>
                      </div>
                    </div>
                    <div className="recipe-meta-row">
                      <div className="recipe-meta-item" title="Action">
                        {getActionIcon(recipe.action.type)}
                        <span className="recipe-meta-label">{ACTION_TYPES.find(t => t.id === recipe.action.type)?.label || recipe.action.type}</span>
                        <span className="recipe-meta-value">{getActionLabel(recipe)}</span>
                      </div>
                    </div>

                    {recipe.trigger.type === 'webhook' && (
                      <div className="webhook-url-row">
                        <code className="webhook-url">
                          POST {baseUrl}/api/webhook/{recipe.id}
                        </code>
                        <button
                          className="copy-btn"
                          onClick={() => copyToClipboard(`${baseUrl}/api/webhook/${recipe.id}`, `wh-${recipe.id}`)}
                        >
                          {copiedId === `wh-${recipe.id}` ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="recipe-card-footer">
                    <div className="recipe-stats">
                      <Clock size={12} />
                      <span>{recipe.runCount || 0} runs</span>
                      <span className="recipe-sep">|</span>
                      <span>Last: {formatTime(recipe.lastRun)}</span>
                    </div>
                    <div className="recipe-actions">
                      <button className="recipe-action-btn" onClick={() => openEdit(recipe)} title="Edit">
                        <ExternalLink size={14} />
                      </button>
                      <button className="recipe-action-btn delete" onClick={() => handleDelete(recipe.id)} title="Delete">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="recipes-sidebar">
          <div className="recipes-sidebar-header">
            <History size={16} />
            <span>Activity Log</span>
          </div>
          <div className="recipes-log">
            {logEntries.length === 0 ? (
              <div className="recipes-log-empty">No activity yet</div>
            ) : (
              logEntries.slice(0, 50).map(entry => (
                <div key={entry.id} className="recipes-log-entry">
                  <span className="log-time">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                  <span className="log-msg">{entry.message}</span>
                  {entry.detail && <span className="log-detail">{entry.detail}</span>}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="recipes-modal-overlay" onClick={() => setShowForm(false)}>
          <div className="recipes-modal" onClick={e => e.stopPropagation()}>
            <div className="recipes-modal-header">
              <h3>{editingId ? 'Edit Recipe' : 'New Recipe'}</h3>
              <button className="modal-close" onClick={() => setShowForm(false)}><X size={18} /></button>
            </div>

            <div className="recipes-modal-body">
              <div className="form-group">
                <label>Recipe Name</label>
                <input
                  type="text" className="form-input" placeholder="e.g. Morning Greeting"
                  value={form.name} onChange={e => handleFormChange('name', e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Description (optional)</label>
                <input
                  type="text" className="form-input" placeholder="What does this recipe do?"
                  value={form.description} onChange={e => handleFormChange('description', e.target.value)}
                />
              </div>

              {/* Trigger Section */}
              <div className="form-section">
                <label className="form-section-label">Trigger</label>
                <div className="type-selector">
                  {TRIGGER_TYPES.map(t => {
                    const Icon = t.icon;
                    return (
                      <button
                        key={t.id}
                        className={`type-btn ${form.trigger.type === t.id ? 'active' : ''}`}
                        onClick={() => handleTriggerTypeChange(t.id)}
                      >
                        <Icon size={16} />
                        <span>{t.label}</span>
                      </button>
                    );
                  })}
                </div>

                {form.trigger.type === 'time' && (
                  <div className="form-group">
                    <label>Schedule</label>
                    <select
                      className="form-select"
                      value={form.trigger.config.schedule || 'interval:60000'}
                      onChange={e => handleTriggerConfig('schedule', e.target.value)}
                    >
                      {TIME_SCHEDULES.map(s => (
                        <option key={s.id} value={s.id}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                )}

                {form.trigger.type === 'file' && (
                  <>
                    <div className="form-group">
                      <label>File / Folder Path</label>
                      <input
                        type="text" className="form-input" placeholder="e.g. C:\Users\..."
                        value={form.trigger.config.path || ''}
                        onChange={e => handleTriggerConfig('path', e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label>Event</label>
                      <select
                        className="form-select"
                        value={form.trigger.config.event || 'change'}
                        onChange={e => handleTriggerConfig('event', e.target.value)}
                      >
                        {FILE_EVENTS.map(e => (
                          <option key={e.id} value={e.id}>{e.label}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                {form.trigger.type === 'webhook' && (
                  <div className="form-hint">
                    No configuration needed. After saving, a unique webhook URL will be generated
                    that you can POST to from any external service.
                  </div>
                )}

                {form.trigger.type === 'email' && (
                  <>
                    <div className="form-group">
                      <label>IMAP Host</label>
                      <input
                        type="text" className="form-input" placeholder="e.g. imap.gmail.com"
                        value={form.trigger.config.host || ''}
                        onChange={e => handleTriggerConfig('host', e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label>Username (email)</label>
                      <input
                        type="text" className="form-input" placeholder="your@email.com"
                        value={form.trigger.config.username || ''}
                        onChange={e => handleTriggerConfig('username', e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label>Password / App Password</label>
                      <input
                        type="password" className="form-input" placeholder="App password"
                        value={form.trigger.config.password || ''}
                        onChange={e => handleTriggerConfig('password', e.target.value)}
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Action Section */}
              <div className="form-section">
                <label className="form-section-label">Action</label>
                <div className="type-selector">
                  {ACTION_TYPES.map(t => {
                    const Icon = t.icon;
                    return (
                      <button
                        key={t.id}
                        className={`type-btn ${form.action.type === t.id ? 'active' : ''}`}
                        onClick={() => handleActionTypeChange(t.id)}
                      >
                        <Icon size={16} />
                        <span>{t.label}</span>
                      </button>
                    );
                  })}
                </div>

                {form.action.type === 'message' && (
                  <div className="form-group">
                    <label>Message Text</label>
                    <textarea
                      className="form-textarea"
                      rows={3}
                      placeholder="Use {{recipeName}}, {{time}}, {{date}} as variables"
                      value={form.action.config.text || ''}
                      onChange={e => handleActionConfig('text', e.target.value)}
                    />
                    <span className="form-hint">Variables: {'{{recipeName}}'} {'{{time}}'} {'{{date}}'}</span>
                  </div>
                )}

                {form.action.type === 'command' && (
                  <div className="form-group">
                    <label>PowerShell Command</label>
                    <textarea
                      className="form-textarea"
                      rows={3}
                      placeholder="e.g. Show-Notification -Title 'NEXUS' -Message 'Recipe triggered'"
                      value={form.action.config.command || ''}
                      onChange={e => handleActionConfig('command', e.target.value)}
                    />
                  </div>
                )}

                {form.action.type === 'api' && (
                  <>
                    <div className="form-row">
                      <div className="form-group">
                        <label>Method</label>
                        <select
                          className="form-select"
                          value={form.action.config.method || 'GET'}
                          onChange={e => handleActionConfig('method', e.target.value)}
                        >
                          <option value="GET">GET</option>
                          <option value="POST">POST</option>
                          <option value="PUT">PUT</option>
                          <option value="DELETE">DELETE</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label>URL</label>
                        <input
                          type="text" className="form-input" placeholder="https://api.example.com/endpoint"
                          value={form.action.config.url || ''}
                          onChange={e => handleActionConfig('url', e.target.value)}
                        />
                      </div>
                    </div>
                  </>
                )}

                {form.action.type === 'blob' && (
                  <>
                    <div className="form-group">
                      <label>Color</label>
                      <div className="color-row">
                        <span className="color-swatch" style={{ background: form.action.config.color || '#aa3bff' }} />
                        <input
                          type="color"
                          className="form-color"
                          value={form.action.config.color || '#aa3bff'}
                          onChange={e => handleActionConfig('color', e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="form-group">
                      <label>Duration (ms)</label>
                      <input
                        type="number" className="form-input" min="1000" max="30000"
                        value={form.action.config.duration || 5000}
                        onChange={e => handleActionConfig('duration', parseInt(e.target.value) || 5000)}
                      />
                      <span className="form-hint">How long the effect lasts in milliseconds</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="recipes-modal-footer">
              <button className="modal-cancel" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="modal-save" onClick={handleSave}>
                {editingId ? 'Update Recipe' : 'Create Recipe'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Recipes;

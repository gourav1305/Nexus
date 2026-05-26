import React, { useState } from 'react';
import { Hexagon, User, Lock, Mail, Eye, EyeOff, Zap, AlertCircle } from 'lucide-react';
import './LoginPage.css';

const LoginPage = ({ onLogin }) => {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body = mode === 'login'
        ? { username, password }
        : { username, password, email: email || undefined, displayName: displayName || undefined };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!data.ok) {
        setError(data.error || 'Something went wrong');
        setLoading(false);
        return;
      }

      onLogin(data.token, data.user, data.settings, data.history);
    } catch (err) {
      setError(err.message || 'Connection failed');
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-grid-bg" />
      <div className="login-card">
        <div className="login-brand">
          <Hexagon size={40} className="login-brand-icon" />
          <span className="login-brand-text">NEXUS</span>
          <span className="login-brand-sub">Automation Assistant</span>
        </div>

        <div className="login-tabs">
          <button
            className={`login-tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => { setMode('login'); setError(''); }}
          >
            <User size={14} /> Sign In
          </button>
          <button
            className={`login-tab ${mode === 'register' ? 'active' : ''}`}
            onClick={() => { setMode('register'); setError(''); }}
          >
            <Zap size={14} /> Register
          </button>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-field">
            <label>Username</label>
            <div className="login-input-wrap">
              <User size={15} className="login-input-icon" />
              <input
                type="text" className="login-input" placeholder="Enter username"
                value={username} onChange={e => setUsername(e.target.value)}
                autoFocus autoComplete="username"
              />
            </div>
          </div>

          {mode === 'register' && (
            <>
              <div className="login-field">
                <label>Email (optional)</label>
                <div className="login-input-wrap">
                  <Mail size={15} className="login-input-icon" />
                  <input
                    type="email" className="login-input" placeholder="email@example.com"
                    value={email} onChange={e => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                </div>
              </div>
              <div className="login-field">
                <label>Display Name (optional)</label>
                <div className="login-input-wrap">
                  <User size={15} className="login-input-icon" />
                  <input
                    type="text" className="login-input" placeholder="How others see you"
                    value={displayName} onChange={e => setDisplayName(e.target.value)}
                  />
                </div>
              </div>
            </>
          )}

          <div className="login-field">
            <label>Password</label>
            <div className="login-input-wrap">
              <Lock size={15} className="login-input-icon" />
              <input
                type={showPassword ? 'text' : 'password'} className="login-input" placeholder="Enter password"
                value={password} onChange={e => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
              <button type="button" className="login-pw-toggle" onClick={() => setShowPassword(!showPassword)}>
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="login-error">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}

          <button type="submit" className="login-submit" disabled={loading || !username || !password}>
            {loading ? (
              <span className="login-loading">Initializing...</span>
            ) : (
              mode === 'login' ? 'Sign In' : 'Create Account'
            )}
          </button>
        </form>

        <div className="login-footer">
          <span className="login-footer-text">
            {mode === 'login'
              ? "Don't have an account? Register above"
              : 'Already have an account? Sign in'}
          </span>
          <span className="login-version">NEXUS v1.0</span>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;

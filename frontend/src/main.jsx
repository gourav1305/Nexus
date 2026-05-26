import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error('CRITICAL UI ERROR:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '40px', color: 'white', background: '#1a1a1a', minHeight: '100vh', textAlign: 'left' }}>
          <h1 style={{ color: '#ff4d4d' }}>Nexus Core Breach (UI CRASH)</h1>
          <p>The neural interface encountered a fatal exception during mounting.</p>
          <pre style={{ background: '#000', padding: '20px', overflow: 'auto', borderRadius: '8px', border: '1px solid #7dfbff' }}>
            {this.state.error?.toString()}
          </pre>
          <button onClick={() => window.location.reload()} style={{ padding: '10px 20px', background: '#7dfbff', color: '#000', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            Re-Initialize System
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

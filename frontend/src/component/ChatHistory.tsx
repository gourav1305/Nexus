// @ts-nocheck
import React, { useEffect, useRef } from 'react';
import { ChevronLeft, Trash2, MessageSquare } from 'lucide-react';

const ChatHistory = ({ isOpen, onClose, history, onClear }) => {
  const historyEndRef = useRef(null);

  const scrollToBottom = () => {
    historyEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [history, isOpen]);

  return (
    <div className={`history-panel ${isOpen ? 'open' : ''}`}>
      <div className="history-header">
        <div className="header-title">
          <MessageSquare className="header-icon" size={18} />
          <h2>NEURAL HISTORY</h2>
        </div>
        <div className="header-actions">
          <button onClick={onClear} className="clear-btn" title="Clear All History">
            <Trash2 size={18} />
          </button>
          <button onClick={onClose} className="close-btn" title="Close Panel">
            <ChevronLeft size={20} />
          </button>
        </div>
      </div>

      <div className="history-content">
        {history.length === 0 ? (
          <div className="empty-history">
            <div className="empty-icon-wrap">
              <MessageSquare size={48} opacity={0.2} />
            </div>
            <p>No neural logs found.</p>
            <span>Start a conversation to record logs.</span>
          </div>
        ) : (
          history.map((item, index) => (
            <div key={index} className={`history-item ${item.role}`}>
              <div className="item-meta">
                <span className="item-role">{item.role === 'user' ? 'USER' : 'NEXUS'}</span>
                <span className="item-time">
                  {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p className="item-text">{item.text}</p>
            </div>
          ))
        )}
        <div ref={historyEndRef} />
      </div>

      <div className="history-footer">
        <span className="footer-info">{history.length} Logs recorded</span>
      </div>
    </div>
  );
};

export default ChatHistory;

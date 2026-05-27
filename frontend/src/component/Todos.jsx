import React, { useState, useEffect } from 'react';
import { CheckCircle2, Circle, Trash2, Plus, Clock, AlertCircle } from 'lucide-react';

const Todos = ({ user, token }) => {
  const [todos, setTodos] = useState([]);
  const [newTodo, setNewTodo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchTodos();
  }, []);

  const fetchTodos = async () => {
    try {
      const res = await fetch('/api/auth/todos', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) {
        setTodos(data.todos);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Failed to fetch todos');
    } finally {
      setLoading(false);
    }
  };

  const handleAddTodo = async (e) => {
    e.preventDefault();
    if (!newTodo.trim()) return;

    try {
      const res = await fetch('/api/auth/todos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text: newTodo }),
      });
      const data = await res.json();
      if (data.ok) {
        setTodos([data.todo, ...todos]);
        setNewTodo('');
      }
    } catch (err) {
      setError('Failed to add todo');
    }
  };

  const toggleTodo = async (id, completed) => {
    try {
      const res = await fetch(`/api/auth/todos/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ completed: !completed }),
      });
      const data = await res.json();
      if (data.ok) {
        setTodos(todos.map((t) => (t.id === id ? data.todo : t)));
      }
    } catch (err) {
      setError('Failed to update todo');
    }
  };

  const deleteTodo = async (id) => {
    if (!window.confirm('Delete this task?')) return;
    try {
      const res = await fetch(`/api/auth/todos/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) {
        setTodos(todos.filter((t) => t.id !== id));
      }
    } catch (err) {
      setError('Failed to delete todo');
    }
  };

  if (loading) return <div className="p-8 text-cyan-400 animate-pulse">Loading Nexus Task Core...</div>;

  return (
    <div className="flex flex-col h-full bg-[#050508]/60 backdrop-blur-[40px] text-slate-200 overflow-hidden relative">
      {/* Background Decorative Elements */}
      <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-purple-500/5 rounded-full blur-[120px] pointer-events-none" />

      {/* Terminal Header */}
      <div className="relative z-10 p-8 border-b border-white/[0.03] bg-gradient-to-r from-blue-500/[0.02] to-transparent">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-[0.2em] uppercase font-['Orbitron'] flex items-center gap-3 text-white">
              <span className="w-2 h-8 bg-cyan-400 rounded-full shadow-[0_0_15px_rgba(34,211,238,0.5)]" />
              Mission Terminal
            </h2>
            <p className="text-[10px] text-cyan-400/50 mt-2 uppercase tracking-[4px] font-medium">
              Priority Objective Tracking System v4.0.2
            </p>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-slate-500 uppercase tracking-widest">System Status</div>
            <div className="flex items-center gap-2 mt-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse" />
              <span className="text-[11px] text-slate-400 font-bold uppercase tracking-tighter">Operational</span>
            </div>
          </div>
        </div>
      </div>

      {/* Command Input Module */}
      <div className="relative z-10 px-8 py-6">
        <form onSubmit={handleAddTodo} className="relative group">
          <div className="absolute -inset-0.5 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 rounded-xl blur opacity-30 group-focus-within:opacity-100 transition duration-1000 group-focus-within:duration-200"></div>
          <div className="relative flex gap-3 bg-[#0a0a0f] border border-white/10 rounded-xl p-2">
            <div className="flex items-center pl-3">
              <Plus className="w-5 h-5 text-slate-500 shrink-0" />
            </div>
            <input
              type="text"
              value={newTodo}
              onChange={(e) => setNewTodo(e.target.value)}
              placeholder="Initialize new objective protocol..."
              className="flex-1 bg-transparent border-none py-3 text-sm focus:outline-none placeholder:text-slate-700 font-medium"
            />
            <button
              type="submit"
              className="px-6 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 text-[10px] font-bold uppercase tracking-[2px] border border-cyan-500/20 rounded-lg transition-all"
            >
              Log Entry
            </button>
          </div>
        </form>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-4 custom-scrollbar relative z-10">
        {error && (
          <div className="p-4 bg-red-500/5 border border-red-500/20 text-red-400 text-[11px] rounded-xl flex items-center gap-3 backdrop-blur-md">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="uppercase tracking-widest">{error}</span>
          </div>
        )}

        {/* Voice Command Guidance Card */}
        <div className="bg-[#0a0a0f]/80 border border-white/[0.05] rounded-2xl p-6 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
            <CheckCircle2 className="w-16 h-16 text-cyan-400" />
          </div>
          <h3 className="text-[11px] uppercase tracking-[3px] text-cyan-400 font-bold mb-4 flex items-center gap-2">
             Voice Interaction Schema
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 bg-white/[0.02] rounded-lg border border-white/[0.05]">
              <div className="text-[9px] text-slate-500 uppercase tracking-widest mb-1">Creation</div>
              <div className="text-xs text-slate-300 font-medium font-['JetBrains_Mono']">"Add task [objective]"</div>
            </div>
            <div className="p-3 bg-white/[0.02] rounded-lg border border-white/[0.05]">
              <div className="text-[9px] text-slate-500 uppercase tracking-widest mb-1">Retrieval</div>
              <div className="text-xs text-slate-300 font-medium font-['JetBrains_Mono']">"Show my list"</div>
            </div>
          </div>
        </div>

        {todos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="relative mb-6">
              <div className="absolute -inset-4 bg-cyan-500/10 rounded-full blur-2xl" />
              <Clock className="w-12 h-12 text-slate-800 relative" />
            </div>
            <h4 className="text-lg font-bold text-slate-600 tracking-tight">Zero Active Protocols</h4>
            <p className="text-xs text-slate-500 mt-2 max-w-[240px] leading-relaxed uppercase tracking-widest font-medium opacity-50">
              Standing by for objective initialization via terminal or vocal uplink.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {todos.map((todo) => (
              <div
                key={todo.id}
                className={`group flex items-center gap-4 p-5 rounded-2xl border transition-all duration-300 ${
                  todo.completed
                    ? 'bg-slate-900/20 border-white/5 opacity-50'
                    : 'bg-[#0e0e15] border-white/[0.08] hover:border-cyan-500/40 hover:bg-[#12121d] hover:shadow-[0_10px_30px_rgba(0,0,0,0.4)]'
                }`}
              >
                <button
                  onClick={() => toggleTodo(todo.id, todo.completed)}
                  className={`transition-all duration-500 ${
                    todo.completed 
                      ? 'text-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.3)]' 
                      : 'text-slate-700 group-hover:text-cyan-400/60'
                  }`}
                >
                  {todo.completed ? <CheckCircle2 className="w-6 h-6" /> : <Circle className="w-6 h-6" />}
                </button>
                
                <span className={`flex-1 text-[13px] font-medium tracking-tight ${
                  todo.completed ? 'line-through decoration-slate-700 text-slate-600' : 'text-slate-200'
                }`}>
                  {todo.text}
                </span>

                <button
                  onClick={() => deleteTodo(todo.id)}
                  className="opacity-0 group-hover:opacity-100 p-2 text-slate-600 hover:text-red-400 hover:bg-red-500/5 rounded-lg transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="p-6 border-t border-white/[0.03] bg-[#050508]/80 relative z-10">
        <div className="flex justify-between items-center">
          <div className="flex gap-6">
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-600 uppercase tracking-widest font-bold">Active Objectives</span>
              <span className="text-xl font-['Orbitron'] text-cyan-400">{todos.filter(t => !t.completed).length}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-600 uppercase tracking-widest font-bold">Completed</span>
              <span className="text-xl font-['Orbitron'] text-slate-400">{todos.filter(t => t.completed).length}</span>
            </div>
          </div>
          <div className="text-[9px] text-slate-700 font-['JetBrains_Mono'] uppercase">
            Data integrity verified // {new Date().toLocaleDateString()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Todos;

import React, { useState, useEffect } from 'react';
import { Calendar as CalendarIcon, Clock, MapPin, Plus, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';

const Calendar = ({ user, token }) => {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [title, setTitle] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [locationInput, setLocationInput] = useState('');
  const [descriptionInput, setDescriptionInput] = useState('');

  const fetchEvents = async () => {
    try {
      const start = new Date(selectedDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(selectedDate);
      end.setHours(23, 59, 59, 999);

      const res = await fetch(`/api/auth/calendar?start=${start.getTime()}&end=${end.getTime()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) {
        setEvents(data.events);
      }
    } catch {
      setError('Failed to fetch schedule');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => { await fetchEvents(); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  const openCreateModal = () => {
    // initialize form with sensible defaults based on selectedDate
    const s = new Date(selectedDate);
    s.setHours(9, 0, 0, 0);
    const e = new Date(selectedDate);
    e.setHours(10, 0, 0, 0);
    setTitle('New Temporal Anchor');
    setStartTime(s.toISOString().slice(0, 16));
    setEndTime(e.toISOString().slice(0, 16));
    setLocationInput('');
    setDescriptionInput('');
    setCreateError(null);
    setShowCreate(true);
  };

  const handleCreate = async (ev) => {
    ev && ev.preventDefault();
    setCreateError(null);
    if (!title.trim()) return setCreateError('Title is required');
    if (!startTime || !endTime) return setCreateError('Start and end time required');
    const s = new Date(startTime).getTime();
    const e = new Date(endTime).getTime();
    if (e <= s) return setCreateError('End time must be after start time');
    setCreating(true);
    try {
      const res = await fetch('/api/auth/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: title.trim(), start_time: s, end_time: e, location: locationInput.trim(), description: descriptionInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setCreateError(data?.error || 'Create failed');
      } else {
        setShowCreate(false);
        // refresh events for the selected date
        fetchEvents();
      }
    } catch {
      setCreateError('Create failed');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteEvent = async (id) => {
    if (!window.confirm('Remove this event?')) return;
    try {
      const res = await fetch(`/api/auth/calendar/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) fetchEvents();
    } catch (err) {
      setError('Delete failed');
    }
  };

  const changeDate = (days) => {
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + days);
    setSelectedDate(next);
  };

  return (
    <div className="flex flex-col h-full bg-[#030305]/70 backdrop-blur-[45px] text-slate-200 overflow-hidden relative">
      {/* Dynamic Glow Orbs */}
      <div className="absolute top-[20%] left-[-10%] w-[30%] h-[30%] bg-cyan-500/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[20%] right-[-10%] w-[30%] h-[30%] bg-blue-500/5 rounded-full blur-[100px] pointer-events-none" />

      {/* Chronos Header */}
      <div className="relative z-10 p-8 border-b border-white/[0.03] bg-gradient-to-b from-white/[0.02] to-transparent">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-cyan-500/10 rounded-2xl border border-cyan-500/20 shadow-[0_0_20px_rgba(34,211,238,0.15)]">
              <CalendarIcon className="w-8 h-8 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-[0.25em] uppercase font-['Orbitron'] text-white">
                Chronos Nexus
              </h2>
              <p className="text-[10px] text-cyan-400/60 mt-1 uppercase tracking-[3px] font-semibold">
                Temporal Stream Synchronizer
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-3 bg-black/40 border border-white/5 p-2 rounded-2xl">
            <button 
              onClick={() => changeDate(-1)} 
              className="p-2 hover:bg-white/5 rounded-xl transition-all text-slate-400 hover:text-white"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="px-4 text-center">
              <div className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-0.5">Current Phase</div>
              <div className="text-xs font-mono text-cyan-100 font-bold">{selectedDate.toDateString()}</div>
            </div>
            <button 
              onClick={() => changeDate(1)} 
              className="p-2 hover:bg-white/5 rounded-xl transition-all text-slate-400 hover:text-white"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6 custom-scrollbar relative z-10">
        {/* Chronos Guidance Block */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-5 bg-gradient-to-br from-cyan-500/5 to-transparent border border-cyan-500/10 rounded-2xl">
            <h3 className="text-[10px] uppercase tracking-widest text-cyan-400 font-bold mb-3 flex items-center gap-2">
              <Clock className="w-3 h-3" /> Uplink Protocols
            </h3>
            <ul className="space-y-2">
              <li className="text-[11px] text-slate-400 flex items-center gap-2">
                <span className="w-1 h-1 bg-cyan-500 rounded-full" />
                "What's my schedule for today?"
              </li>
              <li className="text-[11px] text-slate-400 flex items-center gap-2">
                <span className="w-1 h-1 bg-cyan-500 rounded-full" />
                "Show my meetings"
              </li>
            </ul>
          </div>
          <div className="p-5 bg-gradient-to-br from-blue-500/5 to-transparent border border-blue-500/10 rounded-2xl hidden md:block">
             <h3 className="text-[10px] uppercase tracking-widest text-blue-400 font-bold mb-3 flex items-center gap-2">
              <MapPin className="w-3 h-3" /> Temporal Density
            </h3>
            <div className="flex items-end gap-1 h-8">
               {[4,7,2,9,5,3,6].map((h, i) => (
                 <div key={i} className="flex-1 bg-blue-500/20 rounded-t-sm hover:bg-blue-400/40 transition-all cursor-help" style={{height: `${h*10}%`}} title={`${h} events`} />
               ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 space-y-4">
            <div className="w-12 h-12 border-2 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin" />
            <div className="text-[10px] text-cyan-400 uppercase tracking-[4px] animate-pulse">Synchronizing Stream</div>
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-80 text-center">
            <div className="p-8 rounded-full bg-white/[0.02] border border-white/[0.05] mb-6 relative">
              <div className="absolute inset-0 bg-blue-500/5 rounded-full blur-xl animate-pulse" />
              <Clock className="w-12 h-12 text-slate-800 relative" />
            </div>
            <h4 className="text-lg font-bold text-slate-400 tracking-tight">Timeline is Vacant</h4>
            <p className="text-xs text-slate-500 mt-2 max-w-[280px] leading-relaxed uppercase tracking-[3px] font-medium opacity-60">
              No significant temporal events detected in this frequency.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {events.map((event) => (
              <div key={event.id} className="group relative">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-cyan-500/30 to-blue-500/30 rounded-2xl blur opacity-0 group-hover:opacity-100 transition duration-500" />
                <div className="relative bg-[#0a0a0f]/90 border border-white/10 rounded-2xl p-6 hover:bg-[#0e0e15] transition-all">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-4">
                       <div className="p-2.5 bg-cyan-500/5 rounded-xl border border-cyan-500/10 group-hover:border-cyan-500/30 transition-colors">
                          <Clock className="w-5 h-5 text-cyan-400" />
                       </div>
                       <div>
                          <h3 className="text-base font-bold text-white tracking-tight leading-tight group-hover:text-cyan-100 transition-colors">
                            {event.title}
                          </h3>
                          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">
                            {new Date(event.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — 
                            {new Date(event.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                       </div>
                    </div>
                    <button 
                      onClick={() => handleDeleteEvent(event.id)} 
                      className="opacity-0 group-hover:opacity-100 p-2 text-slate-600 hover:text-red-400 hover:bg-red-500/5 rounded-xl transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  
                  {(event.location || event.description) && (
                    <div className="pl-[52px] space-y-4">
                      {event.location && (
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.03] border border-white/5 rounded-lg w-fit">
                          <MapPin className="w-3 h-3 text-cyan-400/60" />
                          <span className="text-[11px] text-slate-400 font-medium tracking-tight">{event.location}</span>
                        </div>
                      )}
                      {event.description && (
                        <p className="text-xs text-slate-400 leading-relaxed font-light opacity-80 border-l-2 border-cyan-500/20 pl-4 py-1 italic">
                          "{event.description}"
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Temporal Expansion Module */}
      <div className="relative z-10 p-8 border-t border-white/[0.03] bg-[#050510]/80">
        <button onClick={openCreateModal} className="w-full relative group overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-cyan-600 to-blue-600 translate-y-full group-hover:translate-y-0 transition-transform duration-500" />
          <div className="relative py-4 bg-cyan-600/10 text-cyan-400 border border-cyan-500/30 rounded-2xl group-hover:text-white transition-colors flex items-center justify-center gap-3">
            <Plus className="w-5 h-5 shadow-[0_0_10px_rgba(34,211,238,0.5)]" />
            <span className="text-xs font-bold uppercase tracking-[4px]">Log New Temporal Anchor</span>
          </div>
        </button>

        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowCreate(false)} />
            <form onSubmit={handleCreate} className="relative z-60 w-full max-w-md bg-[#07101a] border border-white/[0.06] rounded-2xl p-6 shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-cyan-200">Log Temporal Anchor</h3>
                <button type="button" className="text-slate-400" onClick={() => setShowCreate(false)}>✕</button>
              </div>
              <label className="block text-xs text-slate-400 mb-1">Title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full mb-3 p-2 bg-transparent border border-white/6 rounded" />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Start</label>
                  <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-full p-2 bg-transparent border border-white/6 rounded" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">End</label>
                  <input type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="w-full p-2 bg-transparent border border-white/6 rounded" />
                </div>
              </div>

              <label className="block text-xs text-slate-400 mb-1 mt-3">Location</label>
              <input value={locationInput} onChange={(e) => setLocationInput(e.target.value)} className="w-full mb-3 p-2 bg-transparent border border-white/6 rounded" />

              <label className="block text-xs text-slate-400 mb-1">Description</label>
              <textarea value={descriptionInput} onChange={(e) => setDescriptionInput(e.target.value)} rows={3} className="w-full mb-3 p-2 bg-transparent border border-white/6 rounded" />

              {createError && <div className="text-xs text-red-400 mb-2">{createError}</div>}

              <div className="flex gap-3 justify-end">
                <button type="button" className="px-3 py-2 bg-white/5 rounded" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" disabled={creating} className="px-4 py-2 bg-cyan-500 text-black rounded font-bold">{creating ? 'Logging...' : 'Log Anchor'}</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};

export default Calendar;

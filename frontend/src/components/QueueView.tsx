import React, { useState } from 'react';
import { GripVertical, Trash2, Check, X, Shield, ShieldAlert } from 'lucide-react';

import type { QueueItem } from '../hooks/useSocket';

interface PendingRequest {
  id: string;
  trackId: string;
  title: string;
  username: string;
}

interface HistoryItem {
  videoId: string;
  title: string;
  status: 'played' | 'skipped';
  timestamp: number;
}

interface QueueViewProps {
  queue: QueueItem[];
  detachedQueue?: QueueItem[];
  isUnsynced?: boolean;
  history: HistoryItem[];
  isHost: boolean;
  onReorder: (oldIndex: number, newIndex: number) => void;
  onLocalReorder?: (oldIndex: number, newIndex: number) => void;
  onRemove: (index: number) => void;
  onLocalRemove?: (index: number) => void;
  onJump: (index: number) => void;
  onLocalJump?: (index: number) => void;
  isRequestOnly?: boolean;
  onToggleRequestOnly?: (val: boolean) => void;
  pendingRequests?: PendingRequest[];
  onApprove?: (id: string) => void;
  onDeny?: (id: string) => void;
}

export const QueueView: React.FC<QueueViewProps> = ({ 
  queue, detachedQueue, isUnsynced, history = [], isHost, onReorder, onLocalReorder, onRemove, onLocalRemove, onJump, onLocalJump,
  isRequestOnly, onToggleRequestOnly, 
  pendingRequests = [], onApprove, onDeny 
}) => {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'queue' | 'pending' | 'history'>('queue');
  const [queueMode, setQueueMode] = useState<'room' | 'local'>('room');

  const activeQueue = (queueMode === 'local' && isUnsynced) ? (detachedQueue || []) : queue;

  const handleDragStart = (e: React.DragEvent, index: number) => {
    if (!isHost && queueMode === 'room') {
      e.preventDefault();
      return;
    }
    setDraggedIndex(index);
    // Needed for Firefox
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.currentTarget.parentNode?.toString() || '');
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if ((!isHost && queueMode === 'room') || draggedIndex === null || draggedIndex === index) return;
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if ((!isHost && queueMode === 'room') || draggedIndex === null || draggedIndex === index) return;
    if (queueMode === 'local') {
      onLocalReorder?.(draggedIndex, index);
    } else {
      onReorder(draggedIndex, index);
    }
    setDraggedIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const getTitle = () => {
    if (activeTab === 'queue') return 'Up Next';
    if (activeTab === 'pending') return 'Pending Requests';
    return 'Playback History';
  };

  const getCount = () => {
    if (activeTab === 'queue') return `${queue.length} items`;
    if (activeTab === 'pending') return `${pendingRequests.length} requests`;
    return `${history.length} tracks`;
  };

  return (
    <div className="flex flex-col h-full bg-zinc-900 rounded-3xl border border-zinc-800 overflow-hidden shadow-2xl">
      <div className="p-4 border-b border-zinc-800 bg-zinc-900/50 flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-widest">
            {getTitle()}
          </h3>
          <span className="text-xs text-zinc-500 font-mono">
            {getCount()}
          </span>
        </div>
        
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-zinc-800/50">
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setActiveTab('queue')}
              className={`text-xs px-3 py-1 rounded-md transition-colors ${activeTab === 'queue' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Queue
            </button>
            {isHost && (
              <button 
                onClick={() => setActiveTab('pending')}
                className={`text-xs px-3 py-1 rounded-md transition-colors flex items-center gap-1 ${activeTab === 'pending' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                Pending
                {pendingRequests.length > 0 && (
                  <span className="bg-red-500 text-white px-1.5 rounded-full text-[10px]">{pendingRequests.length}</span>
                )}
              </button>
            )}
            <button 
              onClick={() => setActiveTab('history')}
              className={`text-xs px-3 py-1 rounded-md transition-colors ${activeTab === 'history' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Previous
            </button>
          </div>
          
          {isHost && (
            <button 
              onClick={() => onToggleRequestOnly?.(!isRequestOnly)}
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md border transition-colors ${isRequestOnly ? 'border-amber-500/50 text-amber-500 bg-amber-500/10' : 'border-emerald-500/50 text-emerald-500 bg-emerald-500/10'}`}
              title={isRequestOnly ? "Request Only Mode" : "Fully Open Mode"}
            >
              {isRequestOnly ? <ShieldAlert className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
              {isRequestOnly ? 'Restricted' : 'Open'}
            </button>
          )}
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-2">
        {activeTab === 'queue' && (
          <>
            {isUnsynced && (
              <div className="flex bg-zinc-950 rounded-lg p-1 mb-3">
                <button
                  onClick={() => setQueueMode('room')}
                  className={`flex-1 text-[10px] font-black uppercase tracking-widest py-1.5 rounded-md transition-all ${queueMode === 'room' ? 'bg-zinc-800 text-white' : 'text-zinc-600 hover:text-zinc-400'}`}
                >
                  Room Queue
                </button>
                <button
                  onClick={() => setQueueMode('local')}
                  className={`flex-1 text-[10px] font-black uppercase tracking-widest py-1.5 rounded-md transition-all ${queueMode === 'local' ? 'bg-amber-500/20 text-amber-500' : 'text-zinc-600 hover:text-zinc-400'}`}
                >
                  My Session Queue
                </button>
              </div>
            )}
            {activeQueue.length === 0 ? (
              <div className="text-center text-zinc-600 text-sm mt-8">Queue is empty</div>
            ) : (
            <ul className="space-y-2">
              {activeQueue.map((item, idx) => (
                <li
                  key={`${item.videoId}-${idx}`}
                  draggable={isHost || queueMode === 'local'}
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDrop={(e) => handleDrop(e, idx)}
                  onDragEnd={handleDragEnd}
                  onClick={() => (isHost || queueMode === 'local') ? (queueMode === 'local' ? onLocalJump?.(idx) : onJump(idx)) : null}
                  className={`flex items-center gap-3 p-3 bg-zinc-950/50 hover:bg-zinc-800/80 rounded-xl border border-zinc-800/50 transition-colors group ${draggedIndex === idx ? 'opacity-50 border-dashed' : ''} ${(isHost || queueMode === 'local') ? 'cursor-pointer' : ''}`}
                >
                  {(isHost || queueMode === 'local') && (
                    <GripVertical className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 cursor-grab active:cursor-grabbing" onClick={(e) => e.stopPropagation()} />
                  )}
                  <div className="text-xs text-zinc-500 w-4 font-mono text-right">{idx + 1}.</div>
                  <div className="flex-1 truncate text-sm font-medium text-zinc-300">
                    {item.title}
                  </div>
                  {(isHost || queueMode === 'local') && (
                    <button
                      onClick={(e) => { e.stopPropagation(); queueMode === 'local' ? onLocalRemove?.(idx) : onRemove(idx); }}
                      className="p-1.5 hover:bg-red-500/20 text-zinc-600 hover:text-red-400 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            )}
          </>
        )}

        {activeTab === 'pending' && (
          pendingRequests.length === 0 ? (
            <div className="text-center text-zinc-600 text-sm mt-8">No pending requests</div>
          ) : (
            <ul className="space-y-2">
              {pendingRequests.map((req) => (
                <li
                  key={req.id}
                  className="flex flex-col gap-2 p-3 bg-zinc-950/50 rounded-xl border border-zinc-800/50"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex flex-col min-w-0">
                      <div className="text-sm font-medium text-zinc-300 truncate">
                        {req.title}
                      </div>
                      <span className="text-[10px] text-zinc-500 mt-1">Requested by <span className="text-zinc-400">{req.username}</span></span>
                    </div>
                    {isHost && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => onApprove?.(req.id)}
                          className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 rounded-lg transition-colors"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onDeny?.(req.id)}
                          className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )
        )}

        {activeTab === 'history' && (
          history.length === 0 ? (
            <div className="text-center text-zinc-600 text-sm mt-8">No playback history</div>
          ) : (
            <ul className="space-y-2">
              {[...history].reverse().map((item, idx) => (
                <li
                  key={`${item.videoId}-${item.timestamp}-${idx}`}
                  className="flex items-center gap-3 p-3 bg-zinc-950/30 rounded-xl border border-zinc-800/30 grayscale hover:grayscale-0 transition-all group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-zinc-500 group-hover:text-zinc-300 truncate transition-colors">
                      {item.title}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-sm ${item.status === 'played' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-orange-500/10 text-orange-500'}`}>
                        {item.status}
                      </span>
                      <span className="text-[8px] text-zinc-700 font-mono">
                        {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                  <div className="w-10 h-10 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center overflow-hidden shrink-0">
                    <img src={`https://img.youtube.com/vi/${item.videoId}/default.jpg`} alt="" className="w-full h-full object-cover opacity-50" />
                  </div>
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    </div>
  );
};

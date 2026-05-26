import React, { useState } from 'react';
import { GripVertical, Trash2, Check, X, Shield, ShieldAlert } from 'lucide-react';

interface PendingRequest {
  id: string;
  trackId: string;
  username: string;
}

interface QueueViewProps {
  queue: string[];
  isHost: boolean;
  onReorder: (oldIndex: number, newIndex: number) => void;
  onRemove: (index: number) => void;
  isRequestOnly?: boolean;
  onToggleRequestOnly?: (val: boolean) => void;
  pendingRequests?: PendingRequest[];
  onApprove?: (id: string) => void;
  onDeny?: (id: string) => void;
}

export const QueueView: React.FC<QueueViewProps> = ({ 
  queue, isHost, onReorder, onRemove, 
  isRequestOnly, onToggleRequestOnly, 
  pendingRequests = [], onApprove, onDeny 
}) => {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'queue' | 'pending'>('queue');

  const handleDragStart = (e: React.DragEvent, index: number) => {
    if (!isHost) {
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
    if (!isHost || draggedIndex === null || draggedIndex === index) return;
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (!isHost || draggedIndex === null || draggedIndex === index) return;
    onReorder(draggedIndex, index);
    setDraggedIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  return (
    <div className="flex flex-col h-full bg-zinc-900 rounded-3xl border border-zinc-800 overflow-hidden shadow-2xl">
      <div className="p-4 border-b border-zinc-800 bg-zinc-900/50 flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-widest">
            {activeTab === 'queue' ? 'Up Next' : 'Pending Requests'}
          </h3>
          <span className="text-xs text-zinc-500 font-mono">
            {activeTab === 'queue' ? `${queue.length} items` : `${pendingRequests.length} requests`}
          </span>
        </div>
        
        {isHost && (
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-zinc-800/50">
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setActiveTab('queue')}
                className={`text-xs px-3 py-1 rounded-md transition-colors ${activeTab === 'queue' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                Queue
              </button>
              <button 
                onClick={() => setActiveTab('pending')}
                className={`text-xs px-3 py-1 rounded-md transition-colors flex items-center gap-1 ${activeTab === 'pending' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                Pending
                {pendingRequests.length > 0 && (
                  <span className="bg-red-500 text-white px-1.5 rounded-full text-[10px]">{pendingRequests.length}</span>
                )}
              </button>
            </div>
            
            <button 
              onClick={() => onToggleRequestOnly?.(!isRequestOnly)}
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md border transition-colors ${isRequestOnly ? 'border-amber-500/50 text-amber-500 bg-amber-500/10' : 'border-emerald-500/50 text-emerald-500 bg-emerald-500/10'}`}
              title={isRequestOnly ? "Request Only Mode" : "Fully Open Mode"}
            >
              {isRequestOnly ? <ShieldAlert className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
              {isRequestOnly ? 'Restricted' : 'Open'}
            </button>
          </div>
        )}
      </div>
      
      <div className="flex-1 overflow-y-auto p-2">
        {activeTab === 'queue' ? (
          queue.length === 0 ? (
            <div className="text-center text-zinc-600 text-sm mt-8">Queue is empty</div>
          ) : (
            <ul className="space-y-2">
              {queue.map((trackId, idx) => (
                <li
                  key={`${trackId}-${idx}`}
                  draggable={isHost}
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDrop={(e) => handleDrop(e, idx)}
                  onDragEnd={handleDragEnd}
                  className={`flex items-center gap-3 p-3 bg-zinc-950/50 hover:bg-zinc-800/80 rounded-xl border border-zinc-800/50 transition-colors group ${draggedIndex === idx ? 'opacity-50 border-dashed' : ''} ${isHost ? 'cursor-grab active:cursor-grabbing' : ''}`}
                >
                  {isHost && (
                    <GripVertical className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400" />
                  )}
                  <div className="text-xs text-zinc-500 w-4 font-mono text-right">{idx + 1}.</div>
                  <div className="flex-1 truncate text-sm font-medium text-zinc-300">
                    <a href={`https://youtube.com/watch?v=${trackId}`} target="_blank" rel="noreferrer" className="hover:text-white transition-colors">
                      {trackId}
                    </a>
                  </div>
                  {isHost && (
                    <button
                      onClick={() => onRemove(idx)}
                      className="p-1.5 hover:bg-red-500/20 text-zinc-600 hover:text-red-400 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )
        ) : (
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
                    <div className="flex flex-col">
                      <a href={`https://youtube.com/watch?v=${req.trackId}`} target="_blank" rel="noreferrer" className="text-sm font-medium text-zinc-300 hover:text-white transition-colors">
                        {req.trackId}
                      </a>
                      <span className="text-[10px] text-zinc-500 mt-1">Requested by <span className="text-zinc-400">{req.username}</span></span>
                    </div>
                    {isHost && (
                      <div className="flex items-center gap-1">
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
      </div>
    </div>
  );
};

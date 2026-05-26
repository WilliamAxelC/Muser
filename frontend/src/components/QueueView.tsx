import React, { useState } from 'react';
import { GripVertical, Trash2 } from 'lucide-react';

interface QueueViewProps {
  queue: string[];
  isHost: boolean;
  onReorder: (oldIndex: number, newIndex: number) => void;
  onRemove: (index: number) => void;
}

export const QueueView: React.FC<QueueViewProps> = ({ queue, isHost, onReorder, onRemove }) => {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

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
      <div className="p-4 border-b border-zinc-800 bg-zinc-900/50 flex justify-between items-center">
        <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-widest">Up Next</h3>
        <span className="text-xs text-zinc-500 font-mono">{queue.length} items</span>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {queue.length === 0 ? (
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
        )}
      </div>
    </div>
  );
};

import React, { useState, useRef, useEffect } from 'react';
import { cn } from '../lib/utils';
import type { ChatMessage } from '../hooks/useSocket';

interface ChatViewProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  currentUserId: string;
  chatError?: { message: string, remainingMs: number } | null;
}

export const ChatView: React.FC<ChatViewProps> = ({ messages, onSendMessage, currentUserId, chatError }) => {
  const [text, setText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, chatError]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (text.trim()) {
      onSendMessage(text.trim());
      setText('');
    }
  };

  return (
    <div className="flex flex-col h-full bg-zinc-900 rounded-3xl border border-zinc-800 overflow-hidden shadow-2xl relative">
      <div className="p-4 border-b border-zinc-800 bg-zinc-900/50">
        <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-widest">Room Chat</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="text-center text-zinc-600 text-sm mt-4">No messages yet. Say hi!</div>
        ) : (
          messages.map((msg) => {
            const isSystem = msg.userId === 'system' || msg.username === 'System';
            
            if (isSystem) {
              return (
                <div key={msg.id} className="flex justify-center py-1">
                  <div className="text-[10px] font-bold text-zinc-600/60 uppercase tracking-[0.2em] break-words text-center px-6">
                    --- {msg.text} ---
                  </div>
                </div>
              );
            }

            return (
              <div key={msg.id} className={`flex flex-col ${msg.userId === currentUserId ? 'items-end' : 'items-start'}`}>
                <div className="text-[10px] text-zinc-500 mb-1 font-bold tracking-tight px-1">{msg.username}</div>
                <div className={cn(
                  "px-4 py-2 rounded-2xl max-w-[85%] text-sm break-words shadow-sm",
                  msg.userId === currentUserId 
                    ? 'bg-blue-600 text-white rounded-br-none shadow-blue-900/20' 
                    : 'bg-zinc-800 text-zinc-200 rounded-bl-none shadow-black/20'
                )}>
                  {msg.text}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="p-4 border-t border-zinc-800 bg-zinc-900/50 flex flex-col gap-2 relative">
        {chatError && (
          <div className="text-[10px] font-bold text-red-400 bg-red-950/50 border border-red-900/50 rounded-lg px-3 py-2 text-center animate-in fade-in slide-in-from-bottom-2">
            {chatError.message}
          </div>
        )}
        <form onSubmit={handleSubmit} className="flex gap-2 w-full">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-700 transition-all placeholder:text-zinc-600 text-white"
            disabled={!!chatError}
          />
          <button type="submit" disabled={!!chatError} className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl transition-all active:scale-95 text-sm font-bold">
            Send
          </button>
        </form>
      </div>
    </div>
  );
};

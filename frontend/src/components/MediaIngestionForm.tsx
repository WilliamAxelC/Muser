import React, { useState } from 'react';
import { Plus } from 'lucide-react';

interface MediaIngestionFormProps {
  onIngest: (url: string) => Promise<void>;
  disabled?: boolean;
}

export const MediaIngestionForm: React.FC<MediaIngestionFormProps> = ({ onIngest, disabled }) => {
  const [trackUrl, setTrackUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = trackUrl.trim();
    if (!input || isSubmitting || disabled) return;

    setIsSubmitting(true);
    try {
      await onIngest(input);
      setTrackUrl('');
    } catch (err) {
      console.error('[Ingestion Form Error]', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form 
      onSubmit={handleSubmit} 
      className="flex gap-2 p-1.5 bg-zinc-900 rounded-[1.5rem] border border-zinc-800 focus-within:ring-2 focus-within:ring-zinc-700 transition-all"
    >
      <input
        type="text"
        placeholder="Paste YouTube/Music link..."
        value={trackUrl}
        onChange={(e) => setTrackUrl(e.target.value)}
        disabled={disabled || isSubmitting}
        className="flex-1 bg-transparent px-4 py-2 text-sm focus:outline-none placeholder:text-zinc-600 disabled:opacity-50 text-white"
      />
      <button 
        type="submit" 
        disabled={disabled || isSubmitting}
        className="bg-white text-black p-2.5 rounded-xl hover:bg-zinc-200 transition-all active:scale-95 disabled:opacity-50"
      >
        <Plus className="w-5 h-5" />
      </button>
    </form>
  );
};

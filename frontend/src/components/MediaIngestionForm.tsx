import React, { useState, useEffect, useRef } from 'react';
import { Search, Loader2 } from 'lucide-react';

interface MediaIngestionFormProps {
  onIngest: (url: string, playNext?: boolean) => Promise<void>;
  disabled?: boolean;
}

interface SearchResult {
  videoId: string;
  title: string;
  duration: string;
  author: string;
}

export const MediaIngestionForm: React.FC<MediaIngestionFormProps> = ({ onIngest, disabled }) => {
  const [trackUrl, setTrackUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef<number | ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const performSearch = async (query: string) => {
    if (!query || query.match(/^https?:\/\//)) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    
    setIsSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.results || []);
        setShowDropdown(true);
      }
    } catch (err) {
      console.error('[Search Error]', err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setTrackUrl(val);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    
    if (val.trim().length > 2 && !val.match(/^https?:\/\//)) {
      debounceRef.current = setTimeout(() => {
        performSearch(val.trim());
      }, 500);
    } else {
      setSearchResults([]);
      setShowDropdown(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent, forceInput?: string, mode?: 'next' | 'end') => {
    if (e) e.preventDefault();
    const input = forceInput || trackUrl.trim();
    if (!input || isSubmitting || disabled) return;

    // Prevent submitting raw search queries to the backend ingestion
    if (!forceInput && !input.match(/^https?:\/\//) && input.length !== 11) {
      return;
    }

    setIsSubmitting(true);
    setShowDropdown(false);
    try {
      await onIngest(input, mode === 'next');
      setTrackUrl('');
      setSearchResults([]);
    } catch (err) {
      console.error('[Ingestion Form Error]', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div ref={wrapperRef} className="relative w-full">
      <form 
        onSubmit={(e) => handleSubmit(e, undefined, 'end')} 
        className="flex gap-2 p-1.5 bg-zinc-900 rounded-[1.5rem] border border-zinc-800 focus-within:ring-2 focus-within:ring-zinc-700 transition-all z-20 relative"
      >
        <div className="flex-1 flex items-center bg-transparent px-4">
          <Search className="w-4 h-4 text-zinc-500 mr-2" />
          <input
            type="text"
            placeholder="Search YouTube or paste a link..."
            value={trackUrl}
            onChange={handleInputChange}
            disabled={disabled || isSubmitting}
            className="flex-1 bg-transparent py-2 text-sm focus:outline-none placeholder:text-zinc-600 disabled:opacity-50 text-white"
          />
        </div>
        <button 
          type="submit" 
          disabled={disabled || isSubmitting}
          className="bg-white text-black p-2.5 rounded-xl hover:bg-zinc-200 transition-all active:scale-95 disabled:opacity-50"
        >
          {isSearching ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
        </button>
      </form>
      
      {showDropdown && searchResults.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden z-50 max-h-80 overflow-y-auto">
          {searchResults.map((result) => (
            <div 
              key={result.videoId}
              className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 hover:bg-zinc-800 transition-colors border-b border-zinc-800/50 last:border-b-0 group"
            >
              <div className="flex items-center gap-3 w-full sm:w-auto flex-1 cursor-pointer" onClick={() => handleSubmit(null as any, result.videoId, 'end')}>
                <div className="w-16 h-9 bg-zinc-800 rounded flex items-center justify-center overflow-hidden shrink-0">
                  <img src={`https://img.youtube.com/vi/${result.videoId}/mqdefault.jpg`} className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-zinc-200 truncate">{result.title}</div>
                  <div className="text-[10px] text-zinc-500 truncate">{result.author} • {result.duration}</div>
                </div>
              </div>
              <div className="flex gap-2 w-full sm:w-auto opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity justify-end shrink-0">
                <button onClick={(e) => { e.stopPropagation(); handleSubmit(null as any, result.videoId, 'next'); }} className="text-[10px] px-3 py-1.5 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 rounded-md font-medium whitespace-nowrap">Play Next</button>
                <button onClick={(e) => { e.stopPropagation(); handleSubmit(null as any, result.videoId, 'end'); }} className="text-[10px] px-3 py-1.5 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 rounded-md font-medium whitespace-nowrap">Add to Queue</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};


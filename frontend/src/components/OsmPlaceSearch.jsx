import { useEffect, useRef, useState } from 'react';
import { Search, MapPin, X } from 'lucide-react';
import { searchNominatimPlaces } from '../utils/osmMap.js';

export default function OsmPlaceSearch({
  onSelectPlace,
  placeholder = 'Search OpenStreetMap place or street (e.g. Yaba, Lagos)...',
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [open, setOpen] = useState(false);
  const abortRef = useRef(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setStatusMessage('Enter a street, neighborhood, or city name to search.');
      setOpen(true);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setSearching(true);
    setStatusMessage('');
    setOpen(true);

    try {
      const hits = await searchNominatimPlaces(trimmed, controller.signal);
      setResults(hits);
      if (hits.length === 0) {
        setStatusMessage(`No OpenStreetMap locations matched "${trimmed}".`);
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      setResults([]);
      setStatusMessage('OpenStreetMap Nominatim search is temporarily unavailable. You can still pan or zoom the map directly.');
    } finally {
      setSearching(false);
    }
  };

  const handleClear = () => {
    abortRef.current?.abort();
    setQuery('');
    setResults([]);
    setStatusMessage('');
    setOpen(false);
  };

  const handleChoose = (place) => {
    setQuery(place.shortLabel);
    setOpen(false);
    setStatusMessage('');
    onSelectPlace?.(place);
  };

  return (
    <div role="search" className="relative flex-1 min-w-0 w-full sm:min-w-[240px]">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            aria-label="Search OpenStreetMap location"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSearch();
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
            placeholder={placeholder}
            className="w-full pl-8 pr-8 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-900 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#1F2421]"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear location search"
              onClick={handleClear}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-700"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={handleSearch}
          disabled={searching}
          className="px-3 py-1.5 text-xs font-medium text-white bg-[#1F2421] hover:bg-black disabled:opacity-60 rounded-md whitespace-nowrap shrink-0 transition-colors"
        >
          {searching ? 'Searching...' : 'Find Place'}
        </button>
      </div>

      {open && (results.length > 0 || statusMessage) && (
        <div className="absolute left-0 right-0 mt-1.5 z-[1000] bg-white border border-slate-200 rounded-md shadow-md overflow-hidden">
          {statusMessage ? (
            <p role="status" className="px-3 py-2.5 text-xs text-slate-600">
              {statusMessage}
            </p>
          ) : (
            <ul aria-label="OpenStreetMap search results" className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
              {results.map((place) => (
                <li key={place.id}>
                  <button
                    type="button"
                    onClick={() => handleChoose(place)}
                    className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-start gap-2 transition-colors"
                  >
                    <MapPin className="w-3.5 h-3.5 text-[#1F2421] mt-0.5 shrink-0" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-slate-900 truncate">{place.shortLabel}</p>
                      <p className="text-[11px] text-slate-500 truncate">{place.displayName}</p>
                    </div>
                    <span className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
                      {place.lat.toFixed(4)}, {place.lng.toFixed(4)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

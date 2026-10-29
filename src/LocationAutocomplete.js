import { useEffect, useId, useRef, useState } from "react";
import { searchLocations } from "./geocoding";

export default function LocationAutocomplete({
  label,
  value,
  selectedLocation,
  onChange,
  required = false,
}) {
  const inputId = useId().replace(/:/g, "");
  const listId = `${inputId}-suggestions`;
  const requestId = useRef(0);
  const [suggestions, setSuggestions] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [noResults, setNoResults] = useState(false);
  const [focused, setFocused] = useState(false);
  const isOpen = focused && (suggestions.length > 0 || loading || Boolean(error) || noResults);

  useEffect(() => {
    const query = value.trim();
    setSuggestions([]);
    setActiveIndex(-1);
    setError("");
    setNoResults(false);

    if (selectedLocation || query.length < 2) {
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    const currentRequestId = requestId.current + 1;
    requestId.current = currentRequestId;
    setLoading(true);

    const timeoutId = window.setTimeout(async () => {
      try {
        const results = await searchLocations(query, { signal: controller.signal });
        if (requestId.current === currentRequestId) {
          setSuggestions(results);
          setNoResults(results.length === 0);
        }
      } catch (failure) {
        if (failure.name !== "AbortError" && requestId.current === currentRequestId) {
          setError(failure.message || "Location search is unavailable. Try again.");
        }
      } finally {
        if (requestId.current === currentRequestId) setLoading(false);
      }
    }, 300);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [value, selectedLocation]);

  const chooseSuggestion = (location) => {
    setSuggestions([]);
    setActiveIndex(-1);
    onChange(location.label, location);
  };

  const handleKeyDown = (event) => {
    if (event.key === "ArrowDown" && suggestions.length) {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % suggestions.length);
    } else if (event.key === "ArrowUp" && suggestions.length) {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      chooseSuggestion(suggestions[activeIndex]);
    } else if (event.key === "Escape") {
      setSuggestions([]);
      setActiveIndex(-1);
    }
  };

  return (
    <div className="location-autocomplete">
      <label htmlFor={inputId}>{label}
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={isOpen ? listId : undefined}
          aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          aria-invalid={Boolean(value.trim()) && !selectedLocation}
          autoComplete="off"
          required={required}
          value={value}
          onChange={(event) => onChange(event.target.value, null)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Type a city name"
        />
      </label>
      {isOpen && (
        <div className="location-suggestions" id={listId} role="listbox" aria-label={`${label} suggestions`}>
          {suggestions.map((location, index) => (
            <button
              id={`${listId}-${index}`}
              key={location.id}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? "active" : ""}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseSuggestion(location)}
            >
              {location.label}
            </button>
          ))}
          {loading && <span className="location-search-status" role="status">Searching places…</span>}
          {noResults && <span className="location-search-status">No matching places found.</span>}
          {error && <span className="location-search-error" role="alert">{error}</span>}
          <span className="location-attribution">Place data © OpenStreetMap contributors · Photon</span>
        </div>
      )}
    </div>
  );
}

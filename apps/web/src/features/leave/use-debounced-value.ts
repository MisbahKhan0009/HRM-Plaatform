import { useEffect, useState } from 'react';

/** The value after it has stopped changing for `ms` (FORMS-AND-VALIDATION §2: previews wait 300 ms). */
export function useDebouncedValue<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

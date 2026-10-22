import { Alert, Button } from '@hrm/ui';
import { ApiError } from '../lib/api/client';
import { useErrorMessage } from '../lib/api/errors';

/** Inline load error with Try again and the request id (SCREEN-INVENTORY §0). */
export function LoadError({ thing, error, onRetry }: { thing: string; error: unknown; onRetry: () => void }) {
  const errorMessage = useErrorMessage();
  return (
    <div className="p-4">
      <Alert
        tone="bad"
        title={`We couldn't load ${thing}.`}
        action={
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        }
      >
        {errorMessage(error)}
        {error instanceof ApiError && error.requestId ? (
          <span className="mt-1 block font-mono text-xs text-text-2">{error.requestId}</span>
        ) : null}
      </Alert>
    </div>
  );
}

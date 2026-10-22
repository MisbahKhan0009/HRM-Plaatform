import { useQuery } from '@tanstack/react-query';
import { useCan } from '../../lib/auth/me';
import { employeeQueries } from './api';
import { DEFAULT_REQUIRED_FIELDS } from './forms';

/**
 * Fields the company requires on an employee (`employees.required_fields`). Callers without `settings.read` get the
 * catalogue default; the API enforces the real setting either way.
 */
export function useRequiredEmployeeFields(): readonly string[] {
  const canRead = useCan('settings.read');
  const setting = useQuery({ ...employeeQueries.requiredFields(), enabled: canRead });
  return setting.data ?? DEFAULT_REQUIRED_FIELDS;
}

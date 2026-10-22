import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { MyDocumentsPage } from '../../features/documents/MyDocumentsPage';
import { requireAny } from '../../lib/auth/me';

export const Route = createFileRoute('/_app/documents')({
  validateSearch: z.object({
    page: z.number().int().min(1).default(1).catch(1),
    pageSize: z.number().int().min(1).max(100).default(25).catch(25),
  }),
  beforeLoad: ({ context }) => requireAny(context.queryClient, ['document.read.own']),
  component: MyDocumentsPage,
});

import { schema } from '@hrm/db';
import { type OutgoingEmail, renderEmail, type TemplateData, type TemplateName } from '@hrm/mailer';
import { and, eq } from 'drizzle-orm';
import { unseal } from '../lib/crypto';
import type { Deps } from '../lib/deps';

/**
 * Outbox payloads: ids and display values only (JOBS-AND-OUTBOX §2.1). The loader re-reads recipients at send time
 * and skips anyone who should no longer get mail.
 */
export interface TopicPayloads {
  'email.invitation': { userId: string; inviterUserId: string; sealedToken: string };
  'email.auth_reset': { userId: string };
  'email.new_sign_in_method': {
    userId: string;
    method: 'passkey' | 'authenticator app';
    change: 'added' | 'removed';
  };
  'email.approval_requested': {
    recipientUserId: string;
    subjectLabel: string;
    requesterName: string;
    facts: string[];
    path: string;
  };
  'email.request_decided': {
    recipientUserId: string;
    subjectLabel: string;
    decision: 'approved' | 'rejected';
    comment: string | null;
    reviewerUserId: string | null;
    path: string;
  };
  'email.leave_cancellation_decided': {
    recipientUserId: string;
    decision: 'approved' | 'rejected';
    dates: string;
    path: string;
  };
  'email.payroll_run_returned': { recipientUserId: string; runNumber: string; reason: string; path: string };
  'email.payslip_published': { recipientUserId: string; periodLabel: string; path: string };
  'email.document_expiry_digest': {
    recipientUserId: string;
    items: TemplateData['document_expiry_digest']['items'];
  };
  'email.job_failure_alert': { recipientUserId: string; job: string; occurredAt: string };
}

export type EmailTopic = keyof TopicPayloads;
export type TopicPayload<T extends EmailTopic> = TopicPayloads[T];

type Prepared = OutgoingEmail & { template: TemplateName };

async function recipient(
  deps: Deps,
  companyId: string,
  userId: string,
  statuses: readonly string[] = ['active'],
) {
  const [u] = await deps.db
    .select({ email: schema.users.email, name: schema.users.name, status: schema.users.status })
    .from(schema.users)
    .where(and(eq(schema.users.id, userId), eq(schema.users.companyId, companyId)));
  return u && statuses.includes(u.status) ? u : null;
}

function render<K extends TemplateName>(to: string, template: K, data: TemplateData[K]): Prepared {
  return { to, template, ...renderEmail(template, data) };
}

/** Builds the email for a message, or null when there is nobody to send to any more. */
export async function buildEmail<T extends EmailTopic>(
  deps: Deps,
  companyId: string,
  topic: T,
  payload: TopicPayload<T>,
): Promise<Prepared | null> {
  const origin = deps.env.APP_ORIGIN;
  const p = payload as TopicPayloads[EmailTopic];
  switch (topic) {
    case 'email.invitation': {
      const d = p as TopicPayloads['email.invitation'];
      const to = await recipient(deps, companyId, d.userId, ['invited']);
      if (!to) return null;
      const [company] = await deps.db
        .select({ name: schema.companies.name })
        .from(schema.companies)
        .where(eq(schema.companies.id, companyId));
      const inviter = await recipient(deps, companyId, d.inviterUserId, [
        'active',
        'suspended',
        'deactivated',
      ]);
      const token = await unseal(deps.env.BETTER_AUTH_SECRET, d.sealedToken);
      return render(to.email, 'invitation', {
        companyName: company?.name ?? 'Big-Matrix',
        inviterName: inviter?.name ?? 'HR',
        acceptUrl: `${origin}/accept-invite?token=${token}`,
      });
    }
    case 'email.auth_reset': {
      const d = p as TopicPayloads['email.auth_reset'];
      const to = await recipient(deps, companyId, d.userId);
      return to ? render(to.email, 'auth_reset', { signInUrl: `${origin}/sign-in` }) : null;
    }
    case 'email.new_sign_in_method': {
      const d = p as TopicPayloads['email.new_sign_in_method'];
      const to = await recipient(deps, companyId, d.userId);
      return to
        ? render(to.email, 'new_sign_in_method', {
            method: d.method,
            change: d.change,
            securityUrl: `${origin}/me/security`,
          })
        : null;
    }
    case 'email.approval_requested': {
      const d = p as TopicPayloads['email.approval_requested'];
      const to = await recipient(deps, companyId, d.recipientUserId);
      return to
        ? render(to.email, 'approval_requested', {
            subjectLabel: d.subjectLabel,
            requesterName: d.requesterName,
            facts: d.facts,
            url: `${origin}${d.path}`,
          })
        : null;
    }
    case 'email.request_decided': {
      const d = p as TopicPayloads['email.request_decided'];
      const to = await recipient(deps, companyId, d.recipientUserId);
      if (!to) return null;
      const [hide] = await deps.db
        .select({ value: schema.settings.value })
        .from(schema.settings)
        .where(
          and(eq(schema.settings.companyId, companyId), eq(schema.settings.key, 'approvals.hide_reviewer')),
        );
      const reviewer =
        d.reviewerUserId && hide?.value !== true
          ? await recipient(deps, companyId, d.reviewerUserId, ['active', 'suspended', 'deactivated'])
          : null;
      return render(to.email, 'request_decided', {
        subjectLabel: d.subjectLabel,
        decision: d.decision,
        comment: d.comment,
        reviewerName: reviewer?.name ?? null,
        url: `${origin}${d.path}`,
      });
    }
    case 'email.leave_cancellation_decided': {
      const d = p as TopicPayloads['email.leave_cancellation_decided'];
      const to = await recipient(deps, companyId, d.recipientUserId);
      return to
        ? render(to.email, 'leave_cancellation_decided', {
            decision: d.decision,
            dates: d.dates,
            url: `${origin}${d.path}`,
          })
        : null;
    }
    case 'email.payroll_run_returned': {
      const d = p as TopicPayloads['email.payroll_run_returned'];
      const to = await recipient(deps, companyId, d.recipientUserId);
      return to
        ? render(to.email, 'payroll_run_returned', {
            runNumber: d.runNumber,
            reason: d.reason,
            url: `${origin}${d.path}`,
          })
        : null;
    }
    case 'email.payslip_published': {
      const d = p as TopicPayloads['email.payslip_published'];
      const to = await recipient(deps, companyId, d.recipientUserId);
      return to
        ? render(to.email, 'payslip_published', { periodLabel: d.periodLabel, url: `${origin}${d.path}` })
        : null;
    }
    case 'email.document_expiry_digest': {
      const d = p as TopicPayloads['email.document_expiry_digest'];
      const to = await recipient(deps, companyId, d.recipientUserId);
      return to
        ? render(to.email, 'document_expiry_digest', { items: d.items, url: `${origin}/documents` })
        : null;
    }
    case 'email.job_failure_alert': {
      const d = p as TopicPayloads['email.job_failure_alert'];
      const to = await recipient(deps, companyId, d.recipientUserId);
      return to
        ? render(to.email, 'job_failure_alert', {
            job: d.job,
            occurredAt: d.occurredAt,
            url: `${origin}/settings/system`,
          })
        : null;
    }
    default:
      throw new Error(`Unknown outbox topic ${String(topic)}`);
  }
}

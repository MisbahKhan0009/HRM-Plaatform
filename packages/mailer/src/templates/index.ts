import { layout, type Rendered } from './layout';

/**
 * Template catalogue (EMAIL.md §3). Rules: no salary amounts, national ID numbers, personal contact details or
 * document contents; links carry ids only (the invitation link is the single exception).
 */
export interface TemplateData {
  sign_in_code: { code: string };
  invitation: { companyName: string; inviterName: string; acceptUrl: string };
  auth_reset: { signInUrl: string };
  new_sign_in_method: {
    method: 'passkey' | 'authenticator app';
    change: 'added' | 'removed';
    securityUrl: string;
  };
  approval_requested: { subjectLabel: string; requesterName: string; facts: string[]; url: string };
  request_decided: {
    subjectLabel: string;
    decision: 'approved' | 'rejected';
    comment: string | null;
    reviewerName: string | null;
    url: string;
  };
  leave_cancellation_decided: { decision: 'approved' | 'rejected'; dates: string; url: string };
  payroll_run_returned: { runNumber: string; reason: string; url: string };
  payslip_published: { periodLabel: string; url: string };
  document_expiry_digest: {
    items: { employeeName: string; title: string; expiresOn: string; daysLeft: number }[];
    url: string;
  };
  job_failure_alert: { job: string; occurredAt: string; url: string };
}

export type TemplateName = keyof TemplateData;

const NOT_YOU = 'If you did not expect this email, contact HR.';

const templates: { [K in TemplateName]: (d: TemplateData[K]) => Rendered } = {
  sign_in_code: (d) =>
    layout(`Your sign-in code: ${d.code}`, {
      paragraphs: [
        `Your Big-Matrix HRM sign-in code is ${d.code}.`,
        'It expires in 10 minutes and works once.',
      ],
      footer: 'If you did not ask for a code, ignore this email. Nobody can sign in without the code.',
    }),
  invitation: (d) =>
    layout(`You are invited to ${d.companyName} HRM`, {
      paragraphs: [
        `${d.inviterName} invited you to the ${d.companyName} HR system.`,
        'The link expires in 7 days.',
      ],
      action: { label: 'Accept invitation', url: d.acceptUrl },
      footer: NOT_YOU,
    }),
  auth_reset: (d) =>
    layout('Your sign-in methods were reset', {
      paragraphs: [
        'An administrator removed your passkeys and authenticator app, and signed you out everywhere.',
        'Sign in with an emailed code, then add a passkey again.',
      ],
      action: { label: 'Sign in', url: d.signInUrl },
      footer: NOT_YOU,
    }),
  new_sign_in_method: (d) =>
    layout(`A ${d.method} was ${d.change} on your account`, {
      paragraphs: [`A ${d.method} was ${d.change} on your Big-Matrix HRM account.`],
      action: { label: 'Review security settings', url: d.securityUrl },
      footer: NOT_YOU,
    }),
  approval_requested: (d) =>
    layout(`Approval needed: ${d.subjectLabel} from ${d.requesterName}`, {
      paragraphs: [`${d.requesterName} submitted a ${d.subjectLabel} for your approval.`],
      list: d.facts,
      action: { label: 'Review request', url: d.url },
    }),
  request_decided: (d) =>
    layout(`${capitalize(d.subjectLabel)} ${d.decision}`, {
      paragraphs: [
        d.reviewerName
          ? `Your ${d.subjectLabel} was ${d.decision} by ${d.reviewerName}.`
          : `Your ${d.subjectLabel} was ${d.decision}.`,
        ...(d.comment ? [`Comment: ${d.comment}`] : []),
      ],
      action: { label: 'View request', url: d.url },
    }),
  leave_cancellation_decided: (d) =>
    layout(`Leave cancellation ${d.decision}: ${d.dates}`, {
      paragraphs: [`Your request to cancel leave on ${d.dates} was ${d.decision}.`],
      action: { label: 'View request', url: d.url },
    }),
  payroll_run_returned: (d) =>
    layout(`Payroll run ${d.runNumber} returned`, {
      paragraphs: [`Payroll run ${d.runNumber} was returned to draft.`, `Reason: ${d.reason}`],
      action: { label: 'Open payroll run', url: d.url },
    }),
  payslip_published: (d) =>
    layout(`Your ${d.periodLabel} payslip is ready`, {
      paragraphs: [`Your payslip for ${d.periodLabel} is ready. Open it in the app to view or download it.`],
      action: { label: 'View payslip', url: d.url },
    }),
  document_expiry_digest: (d) =>
    layout(`${d.items.length} document${d.items.length === 1 ? '' : 's'} expiring soon`, {
      paragraphs: ['These documents and contracts expire soon:'],
      list: d.items.map(
        (i) =>
          `${i.employeeName}: ${i.title}, expires ${i.expiresOn} (${i.daysLeft === 0 ? 'today' : `in ${i.daysLeft} days`})`,
      ),
      action: { label: 'Open documents', url: d.url },
    }),
  job_failure_alert: (d) =>
    layout(`Background job failed: ${d.job}`, {
      paragraphs: [`The background job ${d.job} failed at ${d.occurredAt}. Check the system health page.`],
      action: { label: 'Open system health', url: d.url },
    }),
};

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Renders a template. Only English exists in v1; Bangla is added as another catalogue (D-003). */
export function renderEmail<K extends TemplateName>(name: K, data: TemplateData[K]): Rendered {
  return templates[name](data);
}

export const TEMPLATE_NAMES = Object.keys(templates) as TemplateName[];

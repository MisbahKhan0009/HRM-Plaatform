# Content style for the app UI

How the HRM talks to people. It adapts the Big-Matrix voice (`docs/02-brand/source/brand-book.md`, "Voice & tone": precise, calm, engineered, human) to an HR tool where the reader is often busy, sometimes anxious (pay, leave) and never interested in the software itself. All strings live in i18n catalogues (`docs/06-frontend/I18N.md`); this file decides what they say.

## 1. Voice

| Trait | In the HRM | Example |
|---|---|---|
| Precise | Name the exact thing, date and amount | "3 working days of casual leave, 3 to 5 Nov" not "Your leave" |
| Calm | No alarm, no exclamation marks, no blame | "That code has expired. Send a new code." not "Error! Invalid code!" |
| Plain | Short sentences, active voice, everyday words | "Your manager will review it." not "The request has been routed for approval processing." |
| Human | Address the reader as "you"; the system speaks as "we" only for what the system does | "We'll email you when it's decided." |
| Respectful | Pay, leave and personal data are private; never expose a reviewer's private comment to others, never speculate about why | "Rejected by your manager" plus the comment they wrote for the requester |

Never use: hype words, jokes, emoji, "Oops", "Whoops", "Sorry for the inconvenience", "Please" in buttons, Latin abbreviations (e.g., i.e., etc.), or internal terms (enum values, table names, HTTP codes) in user-facing text.

## 2. Mechanics

- **Sentence case** everywhere: titles, buttons, labels, menu items, table headers in data (the mono `label` style renders caps visually through CSS; the string itself stays sentence case so screen readers don't spell it out).
- Numbers as digits ("3 days", "1 request"). Plurals through i18n plural rules, never "day(s)".
- No full stop on labels, buttons, headings or single-sentence toasts; full stops on hint and error text with more than one sentence, and on all body sentences in dialogs.
- Use the person's name when known ("Rahim Uddin's leave request"), "you" for the reader.
- Company name: **Big-Matrix Solutions** first mention, **Big-Matrix** after (brand book). The product is "HRM" in titles; never "the system" in UI text.
- Ellipsis (…) only for actions that open a further step ("Export…"). Progress text: "Uploading…".

## 3. Terminology

Use the left column. The right column lists words not to use for the same thing.

| Use | Not | Notes |
|---|---|---|
| Leave | time off, PTO, vacation, holiday (for leave) | SRS term; leave types keep their configured names |
| Leave request | leave application | |
| Holiday | public holiday, off day | A company holiday from `/settings/holidays` |
| Weekend | off day | Non-working days of the schedule (default Fri and Sat) |
| Check in, check out (verb); check-in, check-out (noun) | clock in, punch, sign in (for attendance) | "Sign in" is only for authentication |
| Attendance correction | adjustment, regularisation | "Adjustment" is reserved for payroll |
| Claim | expense, reimbursement request | Page title "Claims"; record type "transport claim" |
| Payroll run | payroll batch, salary sheet | |
| Payslip | salary slip, pay stub | |
| Gross salary | gross pay (for the structure) | Monthly figure on the salary structure |
| Net pay | take-home, net salary | Amount paid for a period |
| Adjustment | correction (for payroll) | Payroll addition or deduction |
| Approve, reject | accept, decline, deny | |
| Withdraw | cancel (for a pending request) | Pending requests are withdrawn |
| Cancel, cancellation | revoke | Approved leave is cancelled through a cancellation request |
| Return to draft | send back, reopen | Payroll run returned by the approver |
| Lock | freeze, finalise | Payroll run locked |
| Publish | release, send | Payslips |
| Employee code | ID, staff number | Shown as `EMP-0001` |
| Manager | supervisor, line manager, boss | |
| Sign in, sign out | log in, log out, login | |
| Passkey | biometric login, fingerprint login | The device may describe the method itself |
| Authenticator app | 2FA app, OTP app | Name in settings: "Authenticator app" |
| Code | OTP, token, PIN | "Enter the 6-digit code we emailed you" |
| Archive (employee) | delete, remove | Records are never deleted |
| Separation, last working day | termination (unless the exit type is termination), exit | |

## 4. Button and action labels

Verb first, 1 to 3 words, specific to the object when the screen has several objects. The confirm button in a dialog repeats the verb of the action that opened it.

| Context | Label |
|---|---|
| Attendance | Check in · Check out · Request correction |
| Leave | Request leave · Submit request · Withdraw request · Request cancellation · Approve · Reject · Adjust balance |
| Claims | New claim · Submit claim · Save draft |
| Approvals | Review · Approve · Reject · Open full record |
| Employees | Add employee · Create employee · Edit · Invite to sign in · Record employment event · Start separation · Archive · Import CSV · Upload document |
| Payroll | Create payroll run · Calculate · Recalculate · Run checks · Submit for approval · Approve run · Return to draft · Lock run · Record payment · Publish payslips · Mark as reconciled · New adjustment · Add salary structure |
| Reports | Export · Reset filters |
| Security | Add a passkey · Set up authenticator app · Regenerate recovery codes · Sign out · Sign out all other sessions |
| Generic | Save changes · Cancel · Keep it · Close · Try again · Back · Continue |

Avoid "OK", "Yes", "No", "Submit" alone, "Click here".

## 5. Labels, hints and placeholders

- Labels name the data: "Start date", "Amount", "Reason".
- Hints explain constraints before the user hits them: "Up to 10 MB. PDF, JPG or PNG." "Your manager sees this."
- Placeholders show format only: "YYYY-MM-DD", "e.g. Bus fare to client site" is not used (no Latin abbreviation): "Bus fare to client site".
- Optional fields: "(optional)" after the label.

## 6. Error messages by API error code

The API returns `application/problem+json` with a stable `code` (ARCHITECTURE.md section 7). The UI chooses the message by `code`, never by the server's `detail` text. **The list of codes is owned by `docs/05-backend/API-STANDARDS.md`**; when a code there is missing here, add its message here and in the i18n catalogue. Pattern: what happened, then what to do. Interpolated values in angle brackets.

| `code` | Where shown | Message |
|---|---|---|
| `VALIDATION_FAILED` | Per field (from `errors[]`, field `code` mapped through `validation.<code>` keys), plus the error summary | Field text from the shared Zod schema, for example "Enter an end date on or after the start date." Summary: "Check the highlighted fields." |
| `UNAUTHENTICATED` | Redirect to sign-in | "Your session has ended. Sign in again to continue." |
| `OTP_INVALID` | Code field | "That code isn't right or has expired. Check the email or send a new code." |
| `TOTP_INVALID` | Code field | "That code isn't right. Check your authenticator app, or use a recovery code." |
| `MFA_REQUIRED` | Step-up dialog | "Confirm it's you to continue." |
| `REAUTH_REQUIRED` | Step-up dialog | "For your security, confirm it's you before <action>." |
| `ACCOUNT_SUSPENDED` | Sign-in page | "We couldn't sign you in. If you think this is wrong, contact HR." |
| `CSRF_ORIGIN_MISMATCH` | Inline alert | "We couldn't verify this request. Reload the page and try again." |
| `FORBIDDEN` | Inline alert | "You don't have permission to do this. Ask HR if you think you should." |
| `SELF_APPROVAL_FORBIDDEN` | Inline alert | "You can't approve your own request. It's waiting for another approver." |
| `NOT_FOUND` | 404 page or inline | "We couldn't find that page." (Same text for records the user can't access.) |
| `VERSION_CONFLICT` | Inline alert, data reloads | "Someone else changed this while you were editing. We've loaded the latest version. Review it and try again." |
| `INVALID_TRANSITION` | Inline alert, data reloads | "This <record> is now <status>, so you can't <action> it." |
| `EMAIL_TAKEN` | Email field | "Someone already signs in with this email." |
| `WORK_EMAIL_TAKEN` | Work email field | "Another employee already has this work email." |
| `EMPLOYEE_ALREADY_LINKED` | Inline alert in the invite dialog | "This employee already has a sign-in account." (or "This account is already linked to an employee.") |
| `DEPARTMENT_CODE_TAKEN` | Code field | "Another department already uses this code." |
| `DUPLICATE` | The field in `errors[].path` | "<Value> is already in use." (employee code, holiday date, cheque number) |
| `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_IN_PROGRESS` | Toast | "This action is already being processed. Refresh in a moment." |
| `IDEMPOTENCY_KEY_REQUIRED` | Not user-facing (client bug); generic error | see `INTERNAL_ERROR` |
| `PAYROLL_RUN_LOCKED` | Inline alert | "<Month YYYY> payroll is locked. Add an adjustment to the next run instead." |
| `PAYROLL_MISSING_SALARY_STRUCTURE` | Run page, Validation tab (one row per employee from `errors[]`) | "<Name> has no approved salary structure for this period. Add one, then recalculate." |
| `PAYROLL_NEGATIVE_NET` | Validation tab | "<Name>'s net pay is below zero. Check their deductions and adjustments." |
| `PAYROLL_CURRENCY_MISMATCH` | Validation tab | "<Name> has an amount that isn't in BDT. Correct it, then recalculate." |
| `PAYROLL_MIDPERIOD_SALARY_CHANGE_UNCONFIRMED` | Inline alert on Calculate | "<Name>'s salary changes during <Month YYYY>. Set the mid-period salary rule in payroll settings before calculating." |
| `PAYMENT_AMOUNT_MISMATCH` | Payment form or Reconciliation tab | Payment: "This would pay more than <name>'s net pay of <৳ amount>." Reconciliation: "Payments don't match net pay yet. Check the highlighted employees." |
| `PAYROLL_RUN_EXISTS` | Create dialog | "A regular run for <Month YYYY> already exists." with link "Open it" |
| `SELF_APPROVAL_NOTE_REQUIRED` | Justification field | "Explain why you're approving your own run (at least 20 characters)." |
| `SELF_MANAGER` | Manager field | "An employee can't be their own manager." |
| `REPORTING_CYCLE` | Manager field | "<Name> already reports to this employee, so they can't be their manager." |
| `ALREADY_CHECKED_IN` | Check-in panel | "You're already checked in." |
| `NOT_CHECKED_IN` | Check-in panel | "You haven't checked in today, so you can't check out. Request a correction if you forgot." |
| `OVERLAPPING_LEAVE` | Date fields | "You already have leave on <dates>." |
| `INVALID_DATE` | The date field in `errors[].path` | Message by `errors[].code`, for example "Choose a date on or after <joining date>." or "Corrections can only be requested for the last <n> days." |
| `INSUFFICIENT_BALANCE` | Date fields | "You have <n> days of <leave type> available. Shorten the request or choose another type." |
| `LEAVE_NOT_ELIGIBLE` | Leave type field | "You aren't eligible for <leave type> yet." |
| `LEAVE_NO_WORKING_DAYS` | Date fields | "These dates are all weekends or holidays." |
| `FILE_TOO_LARGE` | Upload row | "This file is <size>. The limit is 10 MB." |
| `UNSUPPORTED_FILE_TYPE` | Upload row | "This file type isn't allowed. Use PDF, JPG or PNG." |
| `BUSINESS_RULE_VIOLATION` | Inline alert | Message chosen by the rule key the API names; fallback "This can't be done because of a company rule. Ask HR for details." |
| `RATE_LIMITED` | Inline alert | "Too many attempts. Try again in <minutes> minutes." (from `Retry-After`) |
| `DEPENDENCY_UNAVAILABLE` | Inline alert or toast | "The service is temporarily unavailable. Try again in a minute." |
| `INTERNAL_ERROR`, network failure | Inline alert or toast | "Something went wrong on our side. Try again. If it keeps happening, give HR this reference: <request id>." |

Never show stack traces, SQL, raw `detail`, or permission codenames.

## 7. Confirmation copy

Structure: title = the action as a question or statement; body = the consequence in one or two sentences, including who is affected and whether it can be undone; buttons = verb + "Cancel".

### 7.1 Payroll

| Action | Title | Body | Confirm |
|---|---|---|---|
| Submit for approval | Submit <Month YYYY> payroll? | <n> employees, net pay <৳ amount>. Approvers will be emailed. You can't edit the run while it's waiting for approval. | Submit for approval |
| Approve run | Approve <Month YYYY> payroll? | <n> employees, net pay <৳ amount>. After approval the run can be locked for payment. | Approve run |
| Approve run (self-approval) | Approve your own payroll run? | You prepared this run. Approving it yourself is allowed but flagged for review. Explain why another approver isn't available. | Approve run |
| Return to draft | Return this run to draft? | The preparer will be emailed with your comment. Calculations will need to be run again. | Return to draft |
| Lock run | Lock <Month YYYY> payroll? | After locking, nothing in this run can be changed. Corrections go into an adjustment in a later run. Type <run number> to confirm. | Lock run |
| Record payment | Record payment for <name>? | <৳ amount> paid by <cash/cheque no. 123456> on <date>. | Record payment |
| Record payments (bulk) | Record <n> payments? | Total <৳ amount> paid by <method> on <date>. | Record payments |
| Publish payslips | Publish payslips for <Month YYYY>? | <n> employees will be able to see their payslip. We'll email them. This can't be undone. | Publish payslips |
| Mark as reconciled | Mark <Month YYYY> payroll as reconciled? | Gross, deductions, net and payments match. The run will be closed. | Mark as reconciled |

### 7.2 Other confirmations

| Action | Title | Body | Confirm |
|---|---|---|---|
| Withdraw request | Withdraw this request? | Your manager won't need to review it. | Withdraw request |
| Reject (any) | Reject this <request>? | <Name> will see your comment. | Reject request |
| Request cancellation | Cancel approved leave? | Your manager will review the cancellation. Your balance is restored once it's approved. | Request cancellation |
| Suspend user | Suspend <name>? | They'll be signed out on all devices and can't sign in until reactivated. | Suspend user |
| Deactivate user | Deactivate <name>? | They'll be signed out on all devices. Their records stay in the system. | Deactivate user |
| Archive employee | Archive <name>? | They'll be hidden from lists. Their attendance, leave, payroll and documents stay available in reports and the audit log. | Archive employee |
| Change roles | Change roles for <name>? | They'll get or lose access immediately. This is recorded in the audit log. Type their email to confirm. | Change roles |

## 8. Formats

All dates and times are shown in the company timezone, default `Asia/Dhaka` (FR-ORG-007), regardless of the device timezone. The API sends dates as `YYYY-MM-DD` and timestamps as ISO 8601 UTC.

| Kind | Format (English v1) | Example |
|---|---|---|
| Date | `D MMM YYYY` | 22 Oct 2026 |
| Date in tables (same year) | `D MMM` | 22 Oct |
| Date range | same month: `3 to 5 Nov 2026`; across months: `30 Oct to 2 Nov 2026` | |
| Month (payroll period) | `MMMM YYYY` | November 2026 |
| Time | 12-hour `h:mm a` | 9:12 am |
| Date and time | `D MMM YYYY, h:mm a` | 22 Oct 2026, 9:12 am |
| Relative (lists, under 7 days) | "just now", "5 min ago", "2 days ago" with absolute in tooltip | |
| Duration | `Xh Ym` | 8h 05m |
| Days of leave | decimals only for halves | 1 day, 0.5 day, 2.5 days |
| Money | `৳` + thin space + grouped digits + 2 decimals | ৳ 45,000.00 |
| Large counts | grouped | 1,250 |
| Employee code | as stored | EMP-0001 |
| Week start | Sunday | |

Bangla formats (digits, month names, grouping) are defined when Bangla ships; see `docs/06-frontend/I18N.md`.

## 9. Empty states

Pattern: title says what's empty in plain words; one sentence says what fills it or what to do.

| Screen | Title | Sentence |
|---|---|---|
| My leave | No leave requests yet | Requests you submit appear here with their status. |
| My claims | No claims yet | Submit transport costs here and they're paid with your salary. |
| My payslips | No payslips yet | They appear here once payroll for a month is published. |
| My documents | No documents yet | HR adds documents such as your contract here. |
| Approvals | Nothing waiting for you | New requests from your team appear here. |
| Employees (first use) | No employees yet | Add employees one by one or import a CSV file. |
| Payroll runs | No payroll runs yet | Create a run for the month to calculate pay. |
| Filters matched nothing | No results | Try fewer filters or a different search. |
| Audit log | No matching events | Change the dates or filters. |

## 10. Success messages

Toasts state what happened, past tense, with the object: "Leave request submitted", "Claim approved", "Payment recorded", "Preferences saved". When someone else is notified: "Request submitted. Your manager will review it." Never "Success!".

## 11. Email copy

Email templates are owned by `docs/05-backend/EMAIL.md`. They follow this voice: subject line states the event and the object ("Leave request approved: 3 to 5 Nov"), the body leads with the outcome, includes one link to the record, and never contains salary amounts, codes for sign-in other than the sign-in email itself, or personal data beyond the recipient's own.

## Owner questions (decided, D-049)

All decided on 2026-10-23 (D-049): the default or v1 behaviour written in each item is the decision.


- Should times use 12-hour (`9:12 am`, default here) or 24-hour format?
- Preferred wording for exit types in the separation dialog (see USER-FLOWS.md open questions).

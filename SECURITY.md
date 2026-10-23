# Security policy

This system holds personal, salary and employment data of Big-Matrix Solutions staff. Treat every security issue as urgent.

## Reporting a vulnerability

- **Do not** open a public GitHub issue, pull request or discussion about it.
- Report privately through GitHub's **Report a vulnerability** button (Security tab, private vulnerability reporting), or tell the lead developer or the product owner directly.
- Include: what you found, how to reproduce it, what data or action it exposes, and any suggested fix.
- If you accidentally accessed real personal data, stop, do not copy or share it, and say so in the report.

We acknowledge reports within two working days and agree a fix timeline based on severity.

## Supported versions

Only the version currently deployed to production receives fixes. There is one production installation.

## Scope

In scope: the application code in this repository, its GitHub Actions workflows, and its configuration.

Out of scope here: vulnerabilities in Cloudflare, Neon, Google or other providers. Report those to the provider.

## Handling secrets

- Secrets never go into Git (`docs/08-operations/SECRETS.md`).
- A secret committed by mistake is treated as compromised: rotate it first, then remove it from history.

## Security design

How the system protects data: `docs/03-architecture/SECURITY-MODEL.md`. Threats and tests: `docs/07-quality/THREAT-MODEL.md` and `docs/07-quality/SECURITY-TESTING.md`.

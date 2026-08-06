# Security Policy

## Reporting a vulnerability

**Please do not report security issues through public GitHub issues, pull requests or
discussions.**

Use GitHub's private vulnerability reporting instead:

**[→ Report a vulnerability](https://github.com/coolstartnow/isms-builder/security/advisories/new)**

The report is visible only to the maintainer. No account beyond a normal GitHub login is
required, and the same thread is later used to publish an advisory and, where warranted,
request a CVE.

Helpful in a report: what the issue is, how to reproduce it, which version or commit you tested,
and what an attacker could achieve. A suggested fix is welcome but not expected.

## What to expect

This project is maintained by one person alongside a full-time job. The following is what is
realistically achievable, not a service-level agreement:

- **Acknowledgement** — usually within a week.
- **Assessment** — after acknowledgement, together with you if anything is unclear.
- **Fix** — prioritised by severity, without a fixed deadline. Issues that allow authentication
  bypass, privilege escalation or data disclosure across tenants come first.
- **Credit** — reporters are named in the advisory and the changelog unless they prefer not to be.

If a report goes unanswered for more than two weeks, a reminder in the same thread is welcome —
it will have been missed, not ignored.

## Supported versions

Only the current release receives fixes. There are no long-term support branches; the project
is developed continuously and released frequently.

| Version | Supported |
|---|---|
| Latest release | ✅ |
| Anything older | ❌ — please update |

## Scope

ISMS Builder is self-hosted software. In scope is the code in this repository: the Express
server, the browser frontend, the storage backends, and the shipped default configuration.

**Out of scope:**

- **The demo instance at `demo.isms-builder.de`.** It runs with documented default credentials,
  is reset daily, and deliberately holds only fictitious data. Logging in with published
  credentials, or finding test data in it, is not a vulnerability. Genuine flaws found *through*
  the demo — in the application code — are in scope and very welcome.
- **Deployment of an individual installation.** TLS configuration, reverse proxy, firewall rules,
  operating system hardening, backups and the choice of passwords are the operator's
  responsibility. See [Intended Use and Scope](README.md#intended-use-and-scope).
- **Known and documented behaviour**, in particular that SMTP credentials are stored in plain
  text in `data/org-settings.json` when they are configured through the UI rather than through
  environment variables.
- Vulnerabilities in third-party dependencies without a demonstrable impact on this project.
  These are tracked by `npm audit --audit-level=high` in CI, which fails the build.
- Findings from automated scanners without a demonstrated exploit path.

## Safe harbour

Good-faith security research on your own installation is welcome and will not be met with legal
action. Please do not access data that is not yours, do not degrade availability for others, and
give the project a reasonable opportunity to publish a fix before disclosing publicly.

This does **not** extend to the demo instance beyond ordinary use: it is shared infrastructure,
and denial-of-service or destructive testing there affects other people evaluating the project.

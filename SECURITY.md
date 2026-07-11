# Security Policy

## Supported Versions

Security fixes are made against the current `1.x` release line and `main`. Older development snapshots are unsupported.

## Reporting A Vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub Security Advisories for this repository when available, or contact the maintainers privately through the security contact in the repository metadata.

Include:

- the affected component, route, package, or deployment mode;
- reproducible steps and prerequisites;
- expected and observed behavior;
- likely impact and affected data;
- redacted logs, payloads, screenshots, or proof of concept.

Do not include live credentials, provider keys, runtime tokens, customer data, or unredacted private UI content.

## Deployment Expectations

- Use explicit production `CORS_ORIGIN` entries and HTTPS outside localhost.
- Generate unique high-entropy PostgreSQL, encryption, and setup secrets. Mia ships no default credentials.
- Keep `MIA_SECRET_ENCRYPTION_KEY` stable and outside the database backup it protects.
- Keep integration keys on trusted host servers. Browser code receives only short-lived origin-bound runtime tokens.
- Use a dedicated least-privilege account for authenticated UI scans.
- Keep private-network scanning disabled unless Mia is intentionally deployed inside the trusted target network.
- Back up PostgreSQL and persistent uploads together and test restoration.
- Run one backend replica unless equivalent distributed coordination and rate limiting are added and reviewed.

## Product Safety Expectations

Model output is untrusted. Changes that bypass target allowlisting, action schema validation, confirmation binding, idempotency, receipt verification, secret redaction, prompt-injection boundaries, or the prohibited-operation policy will not be accepted.

See [the detailed security model](docs/security.md) for trust boundaries, data handling, scanner controls, runtime policy, and incident guidance.

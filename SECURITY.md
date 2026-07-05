# Security Policy

## Supported Versions

Security fixes are made against the current `main` branch until versioned releases are published.

## Reporting a Vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub Security Advisories for this repository when available, or contact the repository maintainers privately through the security contact listed in the GitHub repository metadata.

Include enough detail to reproduce and assess the report:

- Affected component, route, package, or deployment mode.
- Steps to reproduce.
- Impact and likely affected data.
- Any relevant logs, payloads, or screenshots with secrets redacted.

## Security Design Expectations

- Production deployments must set explicit `CORS_ORIGIN` values.
- Console admin bootstrap tokens and SDK API keys are secrets.
- Per-app scan credentials are for dedicated test accounts only.
- SDK keys should always be app-bound and origin-restricted.
- UI scanning should target owned applications and non-production test accounts unless a production scan has been explicitly approved.

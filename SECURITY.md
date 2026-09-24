# Security policy

## Reporting a vulnerability

Do not disclose an unpatched vulnerability in a public issue, pull request, or discussion. Use [GitHub's private vulnerability reporting form](https://github.com/lwhobley/venuewranglerenterprise/security/advisories/new) when it is enabled for this repository. If that form is unavailable, contact the repository owner through a private channel before sharing technical details.

Send only the minimum evidence needed to reproduce the issue. Do not include production credentials, signing keys, access tokens, customer records, venue security plans, or unredacted incident data.

This repository does not currently promise a response time or emergency support service. Before a customer pilot, the product owner must publish a monitored security contact, define severity and response targets, and agree on customer notification obligations in the contract and DPA. GitHub issue reporting is not an event-day escalation channel.

## Supported release

The current release line is `main`. Security fixes should be reviewed, tested, and released through the repository's CI and iOS release workflows. API dependency advisories are checked in CI; Dependabot checks npm, Flutter pub, and GitHub Actions dependencies weekly.

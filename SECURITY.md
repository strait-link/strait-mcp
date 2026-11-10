# Security policy

## Reporting a vulnerability

Please report security issues privately to **security@straitlink.in**.
Do not open a public GitHub issue, pull request or discussion for a suspected
vulnerability.

Our contact details and disclosure policy are published at
https://straitlink.in/.well-known/security.txt (policy: https://straitlink.in/security/).

Please include:

- the affected package and version (`@straitlink/mcp`, see CHANGELOG.md),
- steps to reproduce or a proof of concept,
- the impact you observed or expect.

We acknowledge reports as soon as we can, keep you updated while we work on a
fix, and credit you in the release notes if you would like.

## Supported versions

Security fixes are released for the latest published version of this server.

## Keys

This MCP server takes your workspace's **secret** key (`st_live_…` / `st_test_…`)
from `STRAIT_SECRET_KEY`. Keep it in an environment variable, never in a flag
you leave in shell history, an app, a web page or a public repo. Apps and web
pages use the **publishable** key (`st_pub_live_…` / `st_pub_test_…`) with the
mobile and web SDKs instead. If a secret key leaks, revoke it in the dashboard
(Settings → Keys) right away and create a new one.

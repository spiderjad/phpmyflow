# Security policy

phpMyFlow gives direct access to databases, so security reports get priority.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private vulnerability reporting
(Security → Report a vulnerability) on this repository, or email
contacto@spiderjad.com. Include steps to reproduce, the affected version and the
impact you see.

You'll get an acknowledgement within 72 hours. Fixes are released as soon as possible
and credited in the release notes unless you prefer otherwise.

## Hardening checklist for installers

- Keep `allow_custom_host` off and list only the servers you need.
- Restrict access to the folder (IP allow-list, VPN or HTTP auth).
- Serve it over HTTPS only.
- Log in with a MySQL user that has only the privileges you need; use `read_only` for viewers.

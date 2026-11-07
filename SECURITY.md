# Security

`gamba-browser` controls a real browser over the Chrome DevTools Protocol. That is a powerful interface and it has no authentication of its own.

## Threat model

Anyone or anything that can reach the CDP port can:

- read cookies and local storage for every site in the profile;
- act as the logged-in user (post, purchase, delete, change settings);
- execute JavaScript in every open tab.

The port is bound to `127.0.0.1`, so the practical exposure is other processes running as your user. That still includes npm postinstall scripts, editor extensions and any agent you run.

## Recommendations

1. **Use a dedicated profile** for automation, not your daily browser profile:
   `GAMBA_PROFILE_DIR="$HOME/.gamba-browser/profile"`.
2. **Never expose the port** to a network interface. The launcher binds to loopback only; do not add `--remote-debugging-address=0.0.0.0`.
3. **Do not browse untrusted pages** in a profile that holds privileged sessions. Page content is attacker-controlled input; a prompt-injected agent with this driver can act on your accounts.
4. **Close the browser** when you are done with a sensitive session.
5. **Treat site recipes as code.** `src/actions/*` and `src/helpers/sites/*` were written for specific flows and may be stale.

## Reporting

Open a private security advisory at
https://github.com/OscarJRM/gamba-browser/security/advisories/new
or email the maintainer. Do not open a public issue for a vulnerability.

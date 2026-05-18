# Security Features — Interactive Examples

This page walks through all the security and access-control features built into this site.
Try each link to see the feature in action.

---

## Public content

### [Rendering test](/test/)

A public page with no password. Tests the markdown rendering engine: headings, code blocks, tables, images, and more. No credentials required — just follow the link.
This file is stored as index.md inside the test folder.

### [sample.md](/sample.md)

Another public page, also without a password. Demonstrates a typical content page.
This file is stored as sample.md at the content root
Unless referenced, only index.md files are publically discoverable.

For added security, files and assets can be password protected.

---

## Cookie persistence

This site stores passwords in browser cookies so you don't have to re-enter them on every visit. Cookies are scoped to `ehlers.tv`, last **90 days**, and are set with `SameSite=Strict; Secure`. No tracking, no third parties — the only thing stored is the password you already typed.

The admin password is also saved as a cookie when you sign in to `/admin`.

You can clear all saved passwords by deleting your cookies for this domain, or by signing out from the admin interface.

---

## Password-protected directory

### [/secret/](/secret/)

**Password: `secret`**

The entire `/secret/` directory is covered by a single folder rule in `content-security.json`:

```json
{ "match": "secret/", "password": "secret" }
```

Any file inside the folder that doesn't have its own rule inherits this password. Enter `secret` at the prompt to reach the section index.

---

## Files inside /secret/

Once inside the secret section (or by navigating directly), you can test the individual files:

### [/secret/protected.md](/secret/protected.md)

**Password: `secret`** (inherited from the folder rule)

This file has no rule of its own. It is covered by the `secret/` directory rule, so the same password grants access.

### [/secret/password.md](/secret/password.md)

**Password: `password`**

This file has its own explicit rule:

```json
{ "match": "secret/password.md", "password": "password" }
```

The more-specific rule wins over the directory rule, so `secret` will *not* work here — only `password` will.

---

## Password-protected asset downloads

Asset downloads use the `/gate/` route. The browser shows a password prompt; after a correct entry the file is streamed directly to your device.

### [/gate/secret/secret.zip](/gate/secret/secret.zip)

**Password: `secret`** (covered by the folder rule `secret/`)

A ZIP archive containing `secret.md`. No per-file rule needed — the directory rule applies to binary assets as well as markdown pages.

### [/gate/secret/password.zip](/gate/secret/password.zip)

**Password: `password`**

A ZIP archive containing `password.md`, protected by its own rule:

```json
{ "match": "secret/password.zip", "password": "password" }
```

---

## Admin interface

### [/admin](/admin)

**Password: `DemoAdmin2026#`**

The built-in file browser for managing content. This demo site is configured **read-only**, so you can browse and inspect files but uploads, deletions, and folder creation are disabled.

The admin is enabled and its password are set in `content-security.json`:

```json
{
  "admin": {
    "enabled": true,
    "password": "DemoAdmin2026#",
    "readonly": true
  }
}
```

---

## How the rules work

Rules are evaluated by specificity — the longest matching `match` string wins:

| Rule (`match`) | Password | Covers |
|---|---|---|
| `secret/` | `secret` | All files in `/secret/` by default |
| `secret/password.md` | `password` | Overrides the folder rule for this file |
| `secret/password.zip` | `password` | Overrides the folder rule for this asset |

Directory rules end with `/` and match any path that starts with that prefix.
File rules match exactly. No wildcards are needed.

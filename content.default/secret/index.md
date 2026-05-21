# Secret Section

Welcome! You entered the correct folder password (`secret`) to reach this index.

Everything in this section demonstrates the layered security features. The four items below each showcase a different behaviour:

| Item | Password | What it shows |
|------|----------|---------------|
| [Protected page](protected.md) | `secret` | Inherits the folder rule |
| [Different password page](password.md) | `password` | Per-file rule overrides folder |
| [secret.zip](secret.zip) | `secret` | Asset protected by the folder rule |
| [password.zip](password.zip) | `password` | Asset with its own rule |

Note: Assets protected with a password that has already been entered will download immediately.

---

## Downloading from the command line

The browser-based gate uses **client-side** password verification (Web Crypto) and sets cookies via JavaScript — there is no server `Set-Cookie` header to capture. The actual file download goes directly to the `/api/asset-download/` endpoint, which accepts a JSON body with the password. No cookies are needed.

### curl (single step)

```bash
curl -X POST \
  "https://markdown-amplified.ehlers.tv/api/asset-download/secret/secret.zip" \
  -H "Content-Type: application/json" \
  -d '{"password":"secret"}' \
  -o secret.zip
```

### wget (single step)

```bash
wget --post-data='{"password":"secret"}' \
  --header='Content-Type: application/json' \
  "https://markdown-amplified.ehlers.tv/api/asset-download/secret/secret.zip" \
  -O secret.zip
```

For a file with its **own** password (e.g. `password.zip` with password `password`):

```bash
curl -X POST \
  "https://markdown-amplified.ehlers.tv/api/asset-download/secret/password.zip" \
  -H "Content-Type: application/json" \
  -d '{"password":"password"}' \
  -o password.zip
```

> Files served with `"download": false` in the security rules will return a 404 regardless of the password — those assets are explicitly blocked from direct download.

---

[← Back to examples](/examples.md)

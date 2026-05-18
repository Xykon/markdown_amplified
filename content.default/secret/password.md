# Different Password Page

You made it in! This page has its **own password** (`password`), which overrides the folder rule.

Even though this file lives inside `/secret` (which has the password `secret`), its specific rule takes precedence. The most-specific matching rule always wins — longer `match` strings beat shorter ones.

This lets you have a folder-wide password for most content, while individual files can require a different (stricter or different) password.

---

[← Back to secret index](/secret/)

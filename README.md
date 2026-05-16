# Simple Markdown Viewer

A static-exported Next.js markdown viewer optimized for direct `.md` URLs and AWS Amplify hosting.

- Live preview: https://markdown-amplified.ehlers.tv
- Public source repository: https://github.com/Xykon/markdown_amplified

This project renders markdown documents from the `content/` directory with a fallback to `content.default/` when `content/` has no markdown files.

- GitHub-style syntax highlighting (light and dark)
- KaTeX math support
- Mermaid diagrams with toolbar and fullscreen zoom
- Table of contents sidebar with desktop/mobile toggle
- Download button for source markdown files
- Light/dark theme toggle with persistence
- Per-file and per-directory security: password protection and date-range gating

## Table of Contents

1. [Project Goals](#project-goals)
2. [How Routing Works](#how-routing-works)
3. [Features](#features)
4. [Project Structure](#project-structure)
5. [Local Development](#local-development)
6. [Build and Export](#build-and-export)
7. [Content Security](#content-security)
8. [Deployment to AWS Amplify](#deployment-to-aws-amplify)
9. [Public Upstream + Private Production Workflow](#public-upstream--private-production-workflow)
10. [Syncing Public Changes into Private Repo](#syncing-public-changes-into-private-repo)
11. [Operational Notes](#operational-notes)
12. [Troubleshooting](#troubleshooting)

## Project Goals

- Keep hosting simple: static site, no runtime server required
- Keep content editing simple: drop markdown files into `content/`
- Support direct URL access to markdown routes such as `/my-file.md`
- Preserve good readability across desktop/mobile and light/dark modes

## How Routing Works

- If `content/` has markdown files, those files render as the live site.
- If `content/` is empty, the site falls back to `content.default/`.
- `content/index.md` renders at `/`
- Every `content/*.md` file renders at `/<filename>.md`
- Dynamic route is handled by `app/[...slug]/page.js`
- URL segments are decoded before file lookup so encoded URLs work

Examples:

- `content/sample.md` -> `/sample.md`
- `content/Message Design (Detailed) abc123.md` -> `/Message%20Design%20(Detailed)%20abc123.md`

## Features

- Markdown rendering with GFM support
- Syntax highlighting via `rehype-highlight`
- KaTeX math rendering via `remark-math` + `rehype-katex`
- Mermaid diagrams rendered client-side with:
	- Copy SVG
	- Download PNG/SVG
	- Fullscreen overlay with zoom controls
- Sticky header with:
	- TOC toggle button
	- Download source button
	- Theme toggle
- Responsive layout:
	- Sidebar TOC on desktop
	- TOC drawer on mobile

## Project Structure

```text
app/
	[...slug]/
		page.js              # Dynamic markdown route loader
		PageWrapper.js       # Route wrapper (uses shared shell)
		MarkdownRenderer.js  # Markdown, highlighting, Mermaid rendering
	Header.js              # Top bar actions
	MarkdownShell.js       # Shared shell with TOC state/layout
	SecurityGate.js        # Client-side password and date-range gate
	TableOfContents.js     # TOC generation and active heading tracking
	ThemeContext.js        # Theme persistence and toggle
	globals.css            # Full UI and token styling
	page.js                # Root route for content/index.md

content/
	...your live docs (optional)

content.default/
	index.md
	sample.md
	README.md
	...starter docs shown when content/ is empty

content-security.json          # Security rules (create from .example)
content-security.json.example  # Annotated example covering all rule types

lib/
	security.mjs           # Build-time rule matching and AES-256-GCM encryption

tools/
	postprocess-export.mjs # Renames .md.html -> .md and cleans .md.txt
```

## Local Development

Install dependencies:

```bash
npm install
```

Run dev server:

```bash
npm run dev
```

Open:

- `http://localhost:3000/`
- `http://localhost:3000/sample.md`

## Build and Export

Production export:

```bash
npm run build
```

This project uses static export and then post-processes output to support direct `.md` route files.

Post-process behavior in `tools/postprocess-export.mjs`:

- Renames `*.md.html` -> `*.md`
- Removes `*.md.txt`
- Copies original markdown files into `out/downloads/` for the download button

## Content Security

Individual files or entire directories can be protected with a password, restricted to a date range, or both. Security rules are defined in `content-security.json` at the project root.

### Setup

Copy the example file and edit it:

```bash
cp content-security.json.example content-security.json
```

Then rebuild the site. Security is applied entirely at build time — no runtime server is required.

### Rule format

```json
{
  "rules": [
    {
      "match": "internal/",
      "password": "hunter2"
    },
    {
      "match": "announcements/launch.md",
      "validFrom": "2025-09-01",
      "validUntil": "2025-09-30"
    },
    {
      "match": "board/q3-pack.md",
      "password": "board2025",
      "validFrom": "2025-09-08",
      "validUntil": "2025-09-12"
    }
  ]
}
```

| Field | Description |
|---|---|
| `match` | Path relative to your content directory. End with `/` to match an entire directory. |
| `password` | Protects the file with a password. |
| `validFrom` | ISO date (e.g. `2025-09-01`). File is unavailable before this date. |
| `validUntil` | ISO date. File is unavailable after this date. |
| `comment` | Optional human note — ignored by the build. |

All fields except `match` are optional and can be combined freely.

### How it works

**Password protection** — the markdown source is encrypted with AES-256-GCM during the build (key derived via PBKDF2, 100 000 iterations). The ciphertext is embedded in the page. A password prompt is shown in the browser; on the correct entry the content is decrypted and rendered client-side. The password is cached in `sessionStorage` so it only needs to be entered once per browser session.

**Date gating** — files outside their `validFrom`/`validUntil` window are excluded from the build entirely (no HTML is generated for them) and also checked client-side on page load. A rebuild is required for a date gate to take effect — see [Enforcing date gates](#enforcing-date-gates) below.

**Download button** — password-protected files are excluded from `out/downloads/` and the download button is hidden, so the source markdown cannot be retrieved by bypassing the password prompt.

**Rule precedence** — the most specific match wins. A rule for `internal/welcome.md` overrides a rule for `internal/`. A rule with no `password` and no dates makes a file publicly accessible even inside a protected directory.

### Enforcing date gates

Because the site is static, date gates only take effect when the site is (re)built. A file unlocked with `validFrom: "2025-09-01"` will not appear until the site is rebuilt on or after that date; a file with `validUntil: "2025-09-30"` will not disappear until the next rebuild after that date.

To automate this, configure a scheduled build in AWS Amplify Console (**App settings → Build settings → Scheduled builds**) timed to coincide with each gate transition.

### Security limitations

This is client-side security. It is meaningfully stronger than filename obscurity — password-protected content is genuinely encrypted and not present in the HTML source — but it is not a substitute for server-side access control. A determined attacker with the ciphertext and enough time could attempt an offline brute-force attack against a weak password. Use a strong, random password for anything genuinely sensitive, and consider Tier 2 (CloudFront Functions or Lambda@Edge) for stricter requirements.

## Deployment to AWS Amplify

1. Push repository to GitHub.
2. In AWS Amplify Console, create a new app and connect the repo.
3. Keep `amplify.yml` and `customHttp.yml` in the repo root so Amplify uses
   the project build settings and custom HTTP headers.
4. **Set the app platform to `WEB` (static hosting), not `WEB_COMPUTE` (SSR).**
   Because this is a Next.js project, Amplify will otherwise treat it as
   SSR and fail at deploy time looking for `.next/required-server-files.json`,
   which a static export never produces. You can switch it via the AWS CLI:

   ```bash
   aws amplify list-apps --query 'apps[].{name:name,appId:appId}' --output table
   aws amplify update-app --app-id <APP_ID> --platform WEB
   ```

   Then redeploy.
5. Every subsequent push triggers a fresh static build.

## Public Upstream + Private Production Workflow

If you want open source code publicly but host private content/config separately, use two remotes in one local clone.

### Recommended model

- Public repo: open-source project code
- Private repo: your production deployment source (includes private markdown content)
- Local machine: one working clone with both remotes

### One-time setup

Clone public project (HTTPS or SSH):

```bash
# HTTPS
git clone https://github.com/Xykon/markdown_amplified.git
# or SSH
git clone git@github.com:Xykon/markdown_amplified.git

cd markdown_amplified
```

Rename default remote to `public`:

```bash
git remote rename origin public
```

Create an empty private repo on GitHub, then add it as the `private` remote.
Pick whichever protocol you have authentication set up for:

```bash
# HTTPS (uses a Personal Access Token or the Git Credential Manager)
git remote add private https://github.com/<your-user>/<your-private-repo>.git

# SSH (uses your SSH key registered with GitHub)
git remote add private git@github.com:<your-user>/<your-private-repo>.git
```

If you do not yet have authentication configured for private GitHub
repositories, see the GitHub docs:

- HTTPS (Personal Access Tokens): https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
- SSH keys: https://docs.github.com/en/authentication/connecting-to-github-with-ssh
- Overview: https://docs.github.com/en/get-started/getting-started-with-git/about-remote-repositories#cloning-with-https-urls

Push current state to private:

```bash
git push -u private main
```

Then connect AWS Amplify to the private repo.

## Syncing Public Changes into Private Repo

When upstream public repo changes:

```bash
git fetch public
git checkout main
git merge public/main
```

Resolve conflicts if needed, then push to private:

```bash
git push private main
```

If you also maintain changes in the private repo, this merge-based flow keeps history clear and predictable.

## Operational Notes

- Filename obscurity is not security. Use `content-security.json` rules for meaningful access control, or keep truly sensitive content in private infrastructure.
- Prefer URL-safe filenames where possible to avoid host/CDN edge-case behavior.
- Spaces and parentheses are supported with proper URL encoding and route decoding.
- Download button reads from `out/downloads/` (generated during build). Password-protected files are excluded from this directory automatically.

## Troubleshooting

### 404 for existing markdown file

Check:

1. File exists under `content/` and ends in `.md`
2. Build completed and `out/<filename>.md` exists
3. URL uses encoded spaces (`%20`) in browsers
4. Deployment has latest build artifacts

### Theme toggle changes but Mermaid style does not update

Mermaid is rendered client-side and should re-render on theme changes. If stale, hard refresh once and verify you are on latest deployed assets.

### Markdown file downloads fail

Ensure `tools/postprocess-export.mjs` copied files to `out/downloads/` and that deployed host includes this folder.

## License

This project is released under the [MIT License](LICENSE).
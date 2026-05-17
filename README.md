# Simple Markdown Viewer

A server-rendered Next.js markdown viewer optimized for direct `.md` URLs and AWS Amplify hosting.

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
- Optional S3 content backend (set `S3_BUCKET` — no local content files needed)

## Table of Contents

1. [Project Goals](#project-goals)
2. [How Routing Works](#how-routing-works)
3. [Features](#features)
4. [Project Structure](#project-structure)
5. [Local Development](#local-development)
6. [Build](#build)
7. [Content Security](#content-security)
8. [S3 Content Backend](#s3-content-backend)
9. [Deployment to AWS Amplify](#deployment-to-aws-amplify)
10. [Public Upstream + Private Production Workflow](#public-upstream--private-production-workflow)
11. [Syncing Public Changes into Private Repo](#syncing-public-changes-into-private-repo)
12. [Operational Notes](#operational-notes)
13. [Troubleshooting](#troubleshooting)

## Project Goals

- Keep hosting simple: server-rendered on AWS Amplify, no separate backend required
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
		page.js              # Dynamic markdown route — server-rendered on each request
		PageWrapper.js       # Route wrapper (uses shared shell)
		MarkdownRenderer.js  # Markdown, highlighting, Mermaid rendering
	asset/[...slug]/
		route.js             # Serves images and binary files from content/
	downloads/[...slug]/
		route.js             # Serves markdown files for download (security-aware)
	Header.js              # Top bar actions
	MarkdownShell.js       # Shared shell with TOC state/layout
	SecurityGate.js        # Client-side password gate and stale-tab date check
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
	security.mjs           # Rule matching and AES-256-GCM encryption
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

### Auto-restart on config changes

Editing `content-security.json` (passwords, date ranges) requires a server restart to take effect, because encrypted content is cached in memory for performance. Install nodemon once and use the watch script to restart automatically whenever the config file changes:

```bash
npm install --save-dev nodemon
npm run dev:watch
```

Changes to markdown files in `content/` don't need a restart — the dev server re-reads them on every request.

## Build

Production build:

```bash
npm run build
```

This produces a standard Next.js server bundle in `.next/`. AWS Amplify deploys it as a serverless SSR app (`WEB_COMPUTE` platform). Images and other assets are served on demand from the `content/` directory via the `/asset/` route; markdown files are served for download via the `/downloads/` route with the same security rules applied as the page itself.

## Content Security

Individual files or entire directories can be protected with a password, restricted to a date range, or both. Security rules are defined in `content-security.json` at the project root.

### Setup

Copy the example file and edit it:

```bash
cp content-security.json.example content-security.json
```

Then rebuild and redeploy the site.

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
| `download` | `true` or `false`. Overrides the default download behaviour (see below). |
| `comment` | Optional human note — ignored at runtime. |

All fields except `match` are optional and can be combined freely.

The default download behaviour is: files without a password are downloadable; password-protected files are not. Set `download: true` to explicitly allow downloading a password-protected file, or `download: false` to disable downloading any file regardless of whether it has a password.

### How it works

**Password protection** — the markdown source is encrypted with AES-256-GCM at request time (key derived via PBKDF2, 100 000 iterations). The ciphertext is embedded in the page. A password prompt is shown in the browser; on the correct entry the content is decrypted and rendered client-side. The password is cached in `sessionStorage` so it only needs to be entered once per browser session.

**Date gating** — enforced server-side on every request. Files outside their `validFrom`/`validUntil` window return a 404 before any content is sent to the browser. No scheduled rebuilds are needed; the check runs against real server time on each page load.

**Download button** — controlled by the `download` field (see rule format above). By default, password-protected files are not downloadable and all others are. The `/downloads/` route enforces this server-side, so setting `download: false` cannot be bypassed by hitting the URL directly.

**Rule precedence** — the most specific match wins. A rule for `internal/welcome.md` overrides a rule for `internal/`. A rule with no `password` and no dates makes a file publicly accessible even inside a protected directory.

### Security limitations

Password protection is a hybrid of server and client. The server refuses to serve pages for date-expired files, but for password-protected files it sends the ciphertext to the browser and lets the client decrypt. This means a determined attacker with the ciphertext could attempt an offline brute-force attack against a weak password. Use a strong, random password for anything genuinely sensitive.

## S3 Content Backend

By default the site reads markdown files from the local `content/` directory (or `content.default/`). Setting the `S3_BUCKET` environment variable switches to an S3 backend — all file reads happen at request time from the specified bucket, with no local content needed in the deployed bundle.

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `S3_BUCKET` | Yes (to enable S3 mode) | Name of the S3 bucket containing your markdown files. |
| `S3_PREFIX` | No | Key prefix within the bucket (e.g. `docs/`). Trailing slash is added automatically if omitted. |

The AWS credentials and region are picked up automatically from the environment. On Amplify, attach an IAM role to the app — no explicit `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` is needed.

### Bucket structure

Objects are stored at `<S3_PREFIX><relpath>`, where `<relpath>` matches the URL path of the page (e.g. `index.md`, `guide/setup.md`). Assets (images etc.) referenced from markdown are served via the `/asset/` route using the same prefix.

Example with `S3_PREFIX=docs/`:

```
docs/index.md          → /
docs/guide/setup.md    → /guide/setup.md
docs/guide/diagram.png → /asset/guide/diagram.png
```

### IAM permissions

The Amplify execution role needs read-only access to the bucket:

```json
{
  "Effect": "Allow",
  "Action": ["s3:GetObject", "s3:ListBucket"],
  "Resource": [
    "arn:aws:s3:::YOUR_BUCKET",
    "arn:aws:s3:::YOUR_BUCKET/*"
  ]
}
```

### Setting the variable on Amplify

In the Amplify Console → App settings → Environment variables, add `S3_BUCKET` (and optionally `S3_PREFIX`). The change takes effect on the next deployment.

`content-security.json` rules continue to work the same way — the path matched against the rules is always the relative path within the bucket prefix, identical to how it works with the filesystem backend.

## Deployment to AWS Amplify

1. Push repository to GitHub.
2. In AWS Amplify Console, create a new app and connect the repo.
3. Keep `amplify.yml` and `customHttp.yml` in the repo root so Amplify uses
   the project build settings and custom HTTP headers.
4. **Set the app platform to `WEB_COMPUTE` (SSR), not `WEB` (static hosting).**
   Because this is a Next.js SSR project, Amplify must be told to treat it as
   a compute app rather than a static site. You can check and set it via the
   AWS CLI:

   ```bash
   aws amplify list-apps --query 'apps[].{name:name,appId:appId,platform:platform}' --output table
   aws amplify update-app --app-id <APP_ID> --platform WEB_COMPUTE
   ```

   Then redeploy.
5. Every subsequent push triggers a fresh SSR build and deployment.

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
- The download button is served by the `/downloads/` route handler, which applies the same security rules as the page route. No build step is needed to make downloads available.

## Troubleshooting

### 404 for existing markdown file

Check:

1. File exists under `content/` and ends in `.md`
2. File is not outside its `validFrom`/`validUntil` window (date-gated files return 404)
3. URL uses encoded spaces (`%20`) in browsers
4. Deployment has completed successfully and is serving the latest build

### Theme toggle changes but Mermaid style does not update

Mermaid is rendered client-side and should re-render on theme changes. If stale, hard refresh once and verify you are on latest deployed assets.

### Markdown file downloads fail

The download is served by the `/downloads/[...slug]` route handler. Check:

1. The file is not password-protected (protected files intentionally return 404 from the download route)
2. The file is within its `validFrom`/`validUntil` window if date-gated
3. The deployment is on `WEB_COMPUTE` — the download route requires SSR and will not work on a `WEB` (static) deployment

## License

This project is released under the [MIT License](LICENSE).
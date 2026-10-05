# The markdown viewer as a container, for a host that is not Amplify.
#
#   docker buildx bake -f docker-bake.hcl --push
#
# Amplify ran this as a Next.js SSR Lambda backed by S3. Here it is an ordinary long-lived Node
# server backed by a directory, which is simpler in every way that matters: content arrives by
# `rsync` instead of an S3 sync, and the fallback the app already has — `content/` if it holds any
# markdown, otherwise `content.default/` — is what makes an empty volume serve the demo site rather
# than an error.
#
# ## What is baked in and what is not
#
# `content.default` is baked in; `content/` is not, and is a mount point the image leaves empty.
# That split is deliberate: the image is public, so it must be safe to publish, and it must behave
# the same for anyone who runs it as it does for the host that has the real content beside it.
#
# ## Why the builder pins $BUILDPLATFORM
#
# The target is an arm64 (Graviton) instance built from an amd64 workstation, so the runtime stage is
# emulated through QEMU. A Next.js build is JavaScript producing JavaScript and has no architecture,
# so it runs natively and only the dependency install is emulated. docker-bake.hcl lists the QEMU
# and buildx setup this needs.

# ── Dependencies, on the build host's own architecture ───────────────────────────────────────
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ── Build ────────────────────────────────────────────────────────────────────────────────────
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# `DOCKER_BUILD=1` is what turns on `output: 'standalone'` in `next.config.js`, and nothing else
# reads it. Without it the build produces the layout Amplify publishes and the runtime stage below
# would have no `server.js` to copy.
#
# The S3 variables are left unset on purpose. `next.config.js` bakes them in as compile-time
# constants, and an empty `S3_BUCKET` is what selects filesystem mode — so this image cannot be
# talked into reading a bucket at runtime, whatever it is handed.
ENV DOCKER_BUILD=1 \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── Runtime ──────────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

# `wget` for the healthcheck: the slim image has neither it nor curl, and a HEALTHCHECK whose
# command does not exist reports unhealthy for ever while the server answers every request.
RUN apt-get update && \
    apt-get install -y --no-install-recommends wget ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# The traced server and its pruned dependencies, then the two things tracing does not carry:
# the static chunks, which are served by the same process here rather than by a CDN.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# The demo site. `content-security.json` lives inside it, which is why the whole directory is
# copied rather than just the markdown.
COPY --from=builder --chown=node:node /app/content.default ./content.default

# The mount point, created empty and owned by the user that will read it. A volume mounted over a
# path the image does not have is created owned by *root*, which an unprivileged process cannot
# then read — and an unreadable content directory looks exactly like an empty one, which here means
# silently serving the demo site instead of the real one.
RUN mkdir -p /app/content && chown node:node /app/content

USER node
EXPOSE 3000

# `/` rather than an API route: it exercises the markdown pipeline and the content resolution, so a
# healthy container is one that can actually render a page.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null 2>&1 || exit 1

CMD ["node", "server.js"]

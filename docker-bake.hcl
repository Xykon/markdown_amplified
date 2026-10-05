# Build the viewer for the instance's architecture and push it.
#
#   docker buildx bake --push                    :latest
#   TAG=2026-09-12 docker buildx bake --push     that tag instead
#
# The builder must use the `docker-container` driver with QEMU registered, or an arm64 build either
# refuses outright or quietly produces amd64 — which shows up only on the instance, as a container
# that exits immediately with "exec format error". Set both up once:
#
#   docker run --privileged --rm tonistiigi/binfmt --install arm64
#   docker buildx create --name cross --driver docker-container --bootstrap
#   docker buildx use cross
#
# The image is public on Docker Hub. `.dockerignore` is what makes that safe, and it is worth
# re-reading before adding anything to this directory.

variable "TAG" { default = "latest" }
variable "IMAGE" { default = "cehlers/simple_markdown" }

group "default" {
  targets = ["markdown"]
}

target "markdown" {
  context    = "."
  dockerfile = "Dockerfile"
  tags       = ["${IMAGE}:${TAG}"]
  # One platform, not a manifest list: nothing else will run this, and a second doubles a build
  # whose dependency install is already emulated.
  platforms  = ["linux/arm64"]
  # Layer cache in the registry beside the image, so `npm ci` is not re-run under emulation on
  # every build. It is the slowest step by a wide margin.
  cache-from = ["type=registry,ref=${IMAGE}:buildcache"]
  cache-to   = ["type=registry,ref=${IMAGE}:buildcache,mode=max"]
}

#!/usr/bin/env bash
# npm publish hook for semantic-release (@semantic-release/exec publishCmd).
#
# Runs inside semantic-release's publish phase, before @semantic-release/github creates the GitHub
# release, so a failed npm publish aborts the release before a GitHub release exists. The git tag is
# pushed earlier by semantic-release core; if publish fails, see RELEASE.md "Recovering an orphaned
# release".
#
# The package is packed once into .release/tarballs/ and that file is what `npm publish` uploads.
# The workflow hands the same file to the SBOM, attestation and SLSA jobs, so those describe the
# published bytes.
#
# The npm registry occasionally answers the publish request with a 404 although the write
# succeeded, so a non-zero exit is checked against the registry before failing.
set -euo pipefail

VERSION="${1:?usage: release-publish.sh <version>}"
PKG="@theqrl/qrl-contracts"
TARBALL_DIR=".release/tarballs"

mkdir -p "${TARBALL_DIR}"
# `npm pack` prints the created filename as its last stdout line.
TARBALL_NAME="$(npm pack --pack-destination "${TARBALL_DIR}" | tail -n 1)"
TARBALL="${TARBALL_DIR}/${TARBALL_NAME}"

# The packed artifact must carry the version being released.
case "${TARBALL_NAME}" in
  *"-${VERSION}.tgz") ;;
  *)
    echo "packed ${TARBALL_NAME} does not match release version ${VERSION} — aborting before publish" >&2
    exit 1
    ;;
esac

# The library sources and its documents must be inside the tarball, and build or release leftovers
# must not.
for required in \
  package/package.json \
  package/README.md \
  package/LICENSE \
  package/MIGRATION-64-BYTE-WORDS.md \
  package/token/SQRCTF1/SQRCTF1.hyp \
  package/token/SQRCTN1/SQRCTN1.hyp \
  package/token/SQRCTB1/SQRCTB1.hyp \
  package/utils/Strings.hyp \
  package/utils/math/Math.hyp; do
  if ! tar -tzf "${TARBALL}" "${required}" > /dev/null 2>&1; then
    echo "tarball is missing ${required} — aborting before publish" >&2
    exit 1
  fi
done
if tar -tzf "${TARBALL}" | grep -E 'node_modules/|^package/\.release/|^package/\.github/|\.tgz$'; then
  echo "tarball contains forbidden paths (above) — aborting before publish" >&2
  exit 1
fi

if [ -n "${RELEASE_PUBLISH_DRY_RUN:-}" ]; then
  echo "dry run: packed and checked ${TARBALL}, not publishing"
  exit 0
fi

echo "Publishing ${PKG}@${VERSION} to npm (trusted publishing, ${TARBALL})"
code=0
npm publish "${TARBALL}" || code=$?

if [ "${code}" -ne 0 ]; then
  echo "npm publish exited ${code} — checking whether ${PKG}@${VERSION} actually landed"
  sleep 15
  published="$(npm view "${PKG}@${VERSION}" version 2>/dev/null || true)"
  if [ "${published}" = "${VERSION}" ]; then
    echo "${PKG}@${VERSION} is on the registry — treating as success"
    exit 0
  fi
  echo "${PKG}@${VERSION} is NOT on the registry — failing before the GitHub release is created"
  exit "${code}"
fi

echo "${PKG}@${VERSION} published"

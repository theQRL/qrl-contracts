# Release Process

Releases are automated with **semantic-release**. Every push to `main` runs `.github/workflows/release.yml`, which reads the commit messages since the last release, decides the next version, and publishes to npm.

## Commit messages

The project uses [Conventional Commits](https://www.conventionalcommits.org/):

- `fix:` and `perf:` release a patch version (1.0.0 → 1.0.1)
- `feat:` releases a minor version (1.0.0 → 1.1.0)
- `!` after the type, or a `BREAKING CHANGE:` footer, releases a major version (1.0.0 → 2.0.0)

Other types (`chore:`, `docs:`, `test:`, `refactor:`, `ci:`, `build:`) do not release. A run that finds no releasable commit still succeeds.

```
fix(strings): reject an address without the Q prefix

feat(token): add SQRCTN1Enumerable

feat(arrays)!: remove unsafeAccess for packed storage arrays
```

A change to a contract's behaviour, storage layout or public API is breaking for anyone who inherits from or links against it, so mark it with `!`.

## What a release does

1. `preflight` compiles the library and runs `npm test` on the tip of `main`.
2. `release` checks that the commit it is about to release contains the one preflight validated, then runs semantic-release, which:
   - sets the version in `package.json` and `package-lock.json`
   - writes `CHANGELOG.md`
   - commits those files and pushes the commit and the `vX.Y.Z` tag
   - packs the package once and publishes that tarball to npm (`scripts/release-publish.sh`)
   - creates the GitHub release
3. The remaining jobs attach checksums, SBOMs, build attestations and SLSA provenance for the published tarball to the GitHub release.

npm publishing uses trusted publishing (OIDC). There is no npm token in the repository.

## One-time setup

The workflow only runs in `theQRL/qrl-contracts`, and needs these before its first run:

- **Baseline tag.** semantic-release finds the last release from git tags. `0.1.0` is on npm but has no tag; without one the first automated release would be `1.0.0` whatever the commits say. Tag the commit that was published (`npm view @theqrl/qrl-contracts@0.1.0 gitHead`) as `v0.1.0` and push the tag.
- **npm trusted publisher.** In the npm settings for `@theqrl/qrl-contracts`, add this repository and `release.yml` as a trusted publisher, with the environment `npm-publish`.
- **GitHub environment.** Create the `npm-publish` environment.
- **Deploy key.** Add a deploy key with write access that is allowed to bypass branch protection on `main`, and store its private half as the `BYPASS_SSH_KEY` secret. semantic-release pushes the release commit and tag with it.

## Publish ordering and failure

`npm publish` runs inside semantic-release's publish phase, before the GitHub release is created:

- A GitHub release for a version means that version is on npm.
- If the publish fails, no GitHub release is created. The git tag has already been pushed, and semantic-release will not retry a version whose tag exists.

After publishing, the workflow checks that the registry serves the version and that its advertised integrity equals the sha-512 of the packed tarball.

## Recovering an orphaned release

State: tag `vX.Y.Z` exists but npm does not serve `X.Y.Z`.

Preferred: land a `fix:` commit and let the pipeline release the next patch version. The orphaned number stays unused. Never move or delete the existing tag.

Manual backfill, only if that exact version must exist and you hold publish rights on `@theqrl`: check out the tag, confirm `git status` is clean, and run `npm publish --access public`. A manual publish has no provenance attestation; say so in the GitHub release. Verify with `npm view @theqrl/qrl-contracts@X.Y.Z version`.

## Recovering a missed release

State: a change that should have been released is on `main`, but its commit type did not trigger a release. The workflow run is green in this case, so check `npm view @theqrl/qrl-contracts version` rather than the run status.

Re-running the workflow does not help, and commits on `main` must not be rewritten. Add a commit instead; semantic-release analyses every commit since the last tag, so one releasable commit releases everything before it:

```bash
git commit --allow-empty -m "fix: <what the missed change did>"
```

Its subject becomes the changelog entry, so describe the change.

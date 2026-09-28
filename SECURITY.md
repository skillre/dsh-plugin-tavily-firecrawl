# Security Policy

## Reporting

Do not open a public issue for a vulnerability that exposes credentials, private data, arbitrary command execution, unsafe filesystem access, or an authentication bypass. Contact the repository owner privately through GitHub first.

## Secrets

This repository must not contain npm tokens, GitHub tokens, API keys, `.env` contents, private keys, captured login output, or user Session data. Examples use obvious placeholders only.

## Release integrity

Normal releases use npm Trusted Publishing/OIDC from the exact `release.yml` workflow and the protected `npm-publish` GitHub Environment. An unprivileged job builds and tests the reviewed commit, uploads a SHA-1/SHA-512-recorded tarball, and the OIDC job checks out no source, installs no project dependencies, disables package caching, pins `https://registry.npmjs.org/`, verifies the artifact, and publishes it with lifecycle scripts disabled. A rerun accepts an existing version only when its registry integrity equals the verified artifact.

## Supported versions

Until the first stable release, only the latest published version receives security fixes unless a release note states otherwise.

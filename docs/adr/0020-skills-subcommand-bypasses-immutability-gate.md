# `airig skills` consumes bare Skills Repos by SHA pin, bypassing the Immutability Gate

To let Users adopt airig without friction from the existing skills-CLI (`skills.sh`) ecosystem, `airig skills add <owner/repo>` installs Skills directly from a repository's Git tree — repos that have no Setup Release and no `ai.zip`. Because there is no immutable GitHub release to attest, the Immutability Gate (ADR-0005) **does not apply** to this path; instead airig resolves the ref to an exact commit SHA and pins that in `ai.json` (`source: "skills-repo"`). This is a deliberate, scoped downgrade: the SHA gives reproducibility (same bytes on re-install) but not supply-chain immutability (the author can force-push and orphan the SHA). It is quarantined under the `skills` subcommand so core `add`/`update` keep the full immutability guarantee for Setup Releases.

## Status

accepted

## Considered Options

- **Author-side migration only (issue #28's original framing)** — PR a workflow into the author's repo that runs `airig migrate` to publish an immutable `ai.zip`, preserving the gate. Rejected as the *primary* path because it requires the author to act, so it doesn't remove day-one switching friction. Retained as a separate follow-up (Goal B) for durable adoption.
- **Tie to the skills.sh registry API** — rejected: couples airig to a proprietary, OIDC-authenticated, rate-limited service that can't even enumerate a repo's Skills.

## Consequences

- Skills Repos are a distinct `source` in `ai.json`; `airig skills` commands operate on them and core `add`/`update` refuse them (and vice-versa).
- A future `airig review` (prompt-injection scan on add/update) becomes more important precisely because the attestation guarantee is absent here.

# Always-online immutability verification

`add` and `update` verify release immutability through a live GitHub API call every time instead of caching an attestation digest in `ai.json` for offline use. Online verification proves the release is still immutable whenever downloaded content is written, which is stronger than proving it was immutable only when first installed; the security benefit is worth the network requirement because users need network access to add or update releases anyway.

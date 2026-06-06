# `add` owns interactive activation

`add` is the public command for making AI Setup artifacts active. It does not download a full remote Setup Release into `.ai/` before activation. Instead, remote `add` verifies immutability, extracts the release into temporary storage, asks for providers first and artifacts second, checks conflicts, then writes selected active artifacts plus required relative symlink dependencies into `.ai/` and creates target symlinks.

If a Setup Release is already installed, `add owner/repo` fetches the currently pinned version and lets the User add more artifacts from that version. `add owner/repo@new-version` errors and points to `update`, because version movement must remain explicit.

`add .` is the local Author dogfooding flow. It has no network or release verification step; it prompts over existing `.ai/` artifacts and wires selected local artifacts.

Why: `.ai/` is active setup source, not a hidden downloaded cache. Keeping selection and activation inside `add` gives Users one obvious command while preserving locality: no command writes remote source files unless the selected artifacts can also be made active.

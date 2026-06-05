# `add` runs the `link` flow

After downloading all Setup Release artifacts into `.ai/`, `add` runs the `link` flow so the user can choose which downloaded artifacts are wired in the same command invocation. Users who add a Setup Release usually want their AI tool to see it immediately, and making first use one interaction avoids a forgotten follow-up command. If the Setup Release is already downloaded, `add` errors and points the user to `link`, `update`, or `remove`; the responsibilities stay separate: `add` manages first-time downloaded content, while `link` manages active symlinks.

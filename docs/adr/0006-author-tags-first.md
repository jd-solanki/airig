# Author tags first

Authors create and push git tags with their preferred git tooling, then run `airig publish [tag]` to create the GitHub release from that tag. Tagging belongs to git history and already has a tooling ecosystem, while `publish` should limit its blast radius to GitHub release creation rather than performing potentially destructive git operations.

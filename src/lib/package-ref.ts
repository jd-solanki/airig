export interface PackageRef {
  owner: string
  repo: string
  tag: string | undefined
}

export function parsePackageRef(pkg: string): PackageRef {
  const atIdx = pkg.lastIndexOf('@')
  let ref = pkg
  let tag: string | undefined

  if (atIdx > 0) {
    tag = pkg.slice(atIdx + 1)
    ref = pkg.slice(0, atIdx)
  }

  const slashIdx = ref.indexOf('/')
  if (slashIdx < 1 || slashIdx === ref.length - 1) {
    throw new Error(`Invalid package reference "${pkg}". Expected: owner/repo or owner/repo@version`)
  }

  return { owner: ref.slice(0, slashIdx), repo: ref.slice(slashIdx + 1), tag }
}

export function parseExactPackageRef(pkg: string): Required<PackageRef> {
  const parsed = parsePackageRef(pkg)
  if (!parsed.tag) {
    throw new Error(`Invalid package reference "${pkg}". Expected exact version: owner/repo@version`)
  }
  return parsed as Required<PackageRef>
}

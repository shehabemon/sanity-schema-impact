/**
 * Variables a Studio reads at load time. They're the only ones `--pass-env` may name, so a
 * Sanity or GitHub token can't reach the Studio's code through that flag.
 */
export const STUDIO_ENV_PREFIX = 'SANITY_STUDIO_';

const PASSABLE = /^SANITY_STUDIO_[A-Za-z0-9_]+$/;

export function isStudioVariable(name: string): boolean {
  return PASSABLE.test(name);
}

/** Parses the `--pass-env` value into variable names. Unset or blank means none. */
export function parsePassEnv(value: string | undefined): string[] {
  if (value === undefined) return [];
  const names = value
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
  for (const name of names) {
    if (!isStudioVariable(name)) {
      throw new Error(
        `--pass-env only takes variable names that start with ${STUDIO_ENV_PREFIX}, such as ${STUDIO_ENV_PREFIX}ID.`,
      );
    }
  }
  return [...new Set(names)];
}

/** Copies the named variables from `env`. A name that isn't set is an error, and it's named. */
export function resolvePassEnv(
  names: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const name of names) {
    const value = env[name];
    if (value === undefined) {
      throw new Error(`${name} is named in --pass-env but not set.`);
    }
    resolved[name] = value;
  }
  return resolved;
}

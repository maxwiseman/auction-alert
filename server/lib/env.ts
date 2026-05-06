export function readEnv(name: string) {
  const value = process.env[name];
  if (!value) return undefined;

  return stripWrappingQuotes(value.trim());
}

export function readEnvAlias(...names: string[]) {
  for (const name of names) {
    const value = readEnv(name);
    if (value) return value;
  }

  return undefined;
}

function stripWrappingQuotes(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

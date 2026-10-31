import pkg from '../../package.json' with { type: 'json' };

/** Lore's version, from package.json (bundled into dist/cli.js at build time). */
export const LORE_VERSION: string = pkg.version;

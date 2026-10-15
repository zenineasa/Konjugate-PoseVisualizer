/* Copyright © 2026 Zenin Easa Panthakkalakath */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultUserData, konjugateModule, repoRoot } from './konjugatePaths.mjs';

const { installPackageArchive } = await import(pathToFileURL(konjugateModule('src/packageArchive.mjs')));

// The build of the current version (package.json's, as scripts/build.mjs names it), not whichever .kja out/ happens to
// list first: out/ keeps earlier builds, and an older one sorts ahead of a newer one.
export function currentArchiveName(names, addonId, version) {
    const name = `${addonId}-${version}.kja`;
    return names.includes(name) ? name : null;
}

// Installs the built package into <userData>/packages with the same code path the app uses, in place of any other
// installed version: Konjugate loads one version of an add-on, and with two installed it may load the older.
// Usage: node scripts/installDev.mjs [userDataDirectory]
export async function installBuiltPackage(userData = defaultUserData()) {
    const outputDirectory = join(repoRoot, 'out');
    const { version } = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
    const { addonId } = JSON.parse(await readFile(join(repoRoot, 'package', 'addon.json'), 'utf8'));
    const name = currentArchiveName(await readdir(outputDirectory).catch(() => []), addonId, version);
    if (!name) throw new Error(`No build of ${addonId} ${version} in ${outputDirectory} -- run the build first.`);
    const result = await installPackageArchive(await readFile(join(outputDirectory, name)), {
        extension: '.kja', directory: join(userData, 'packages'), overwrite: true, replaceOtherVersions: true
    });
    console.log(`Installed ${name} into ${join(userData, 'packages')}`);
    return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await installBuiltPackage(process.argv[2]);

/* Copyright © 2026 Zenin Easa Panthakkalakath */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultUserData, konjugateModule, repoRoot } from './konjugatePaths.mjs';

const { installPackageArchive } = await import(pathToFileURL(konjugateModule('src/packageArchive.mjs')));

// Installs the built package into <userData>/packages with the same code path the app uses.
// Usage: node scripts/installDev.mjs [userDataDirectory]
export async function installBuiltPackage(userData = defaultUserData()) {
    const outputDirectory = join(repoRoot, 'out');
    for (const name of await readdir(outputDirectory)) {
        if (!name.endsWith('.kja')) continue;
        const result = await installPackageArchive(await readFile(join(outputDirectory, name)), {
            extension: '.kja', directory: join(userData, 'packages'), overwrite: true
        });
        console.log(`Installed ${name} into ${join(userData, 'packages')}`);
        return result;
    }
    throw new Error(`No .kja file found in ${outputDirectory} -- run the build first.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await installBuiltPackage(process.argv[2]);

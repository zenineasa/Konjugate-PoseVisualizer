/* Copyright © 2026 Zenin Easa Panthakkalakath */

import assert from 'node:assert/strict';
import test from 'node:test';
import { currentArchiveName } from '../scripts/installDev.mjs';

// out/ keeps earlier builds, and an older one lists first: installing the first .kja found put 1.0.2 back in place
// of a freshly built 1.0.3.
test('the dev install picks the build of the current version, not the first one listed', () => {
    const names = ['konjugate.poseVisualizer-1.0.2.kja', 'konjugate.poseVisualizer-1.0.3.kja', 'notes.txt'];
    assert.equal(currentArchiveName(names, 'konjugate.poseVisualizer', '1.0.3'), 'konjugate.poseVisualizer-1.0.3.kja');
    assert.equal(currentArchiveName(names, 'konjugate.poseVisualizer', '1.0.4'), null);
});

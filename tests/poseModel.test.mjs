/* Copyright © 2026 Zenin Easa Panthakkalakath */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    activeConventions, defaultConvention, describeBody, matchConvention, modelBodyAxes, nearestValue, normalizeConvention,
    normalizeProjectData, normalizeSettings, poseAt, resolveBodies, suggestedView
} from '../package/poseModel.mjs';

// A result catalogue as listSignals gives it: one entry per state, numbered from 100 by node.
function catalogue(nodes) {
    let next = 100;
    return Object.entries(nodes).flatMap(([entityId, states]) => states.map((state) => {
        const [symbol, unit = ''] = state.split(':');
        return { signalId: next++, entityId: Number(entityId), entityName: `Node ${entityId}`, name: symbol, symbol, unit };
    }));
}
const near = (actual, expected, tolerance = 1e-12) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
const constantSeries = (value) => [{ time: 0, value }, { time: 1, value }];

test('by default a node with x, y, z, roll, pitch and yaw is a body, as before, and one missing any is not', () => {
    const signals = catalogue({ 1: ['x', 'y', 'z', 'roll', 'pitch', 'yaw'], 2: ['x', 'y', 'z', 'roll', 'pitch'] });
    const { bodies, others } = resolveBodies(signals);
    assert.deepEqual(bodies.map(({ entityId }) => entityId), [1]);
    assert.deepEqual(bodies[0].roles, { x: 100, y: 101, z: 102, roll: 103, pitch: 104, yaw: 105 });
    assert.deepEqual(bodies[0].source, { kind: 'convention', conventionId: 'konjugate', conventionName: 'Konjugate' });
    assert.deepEqual(others, [{ entityId: 2, entityName: 'Node 2' }]);
});

test('a convention of the user\'s own names finds bodies with only the roles it lists', () => {
    const planar = normalizeConvention({ id: 'planar', name: 'Planar', symbols: { x: 'px', y: 'py', yaw: 'theta' } });
    const slider = normalizeConvention({ id: 'slider', name: 'Slider', symbols: { x: 's' } });
    const signals = catalogue({ 1: ['px', 'py', 'theta', 'omega'], 2: ['s', 'v'], 3: ['x', 'y'] });
    const { bodies, others } = resolveBodies(signals, { conventions: [defaultConvention, planar, slider] });
    assert.deepEqual(bodies.map(({ entityId, roles }) => [entityId, roles]), [[1, { x: 100, y: 101, yaw: 102 }], [2, { x: 104 }]]);
    assert.deepEqual(others.map(({ entityId }) => entityId), [3]);
});

test('when several conventions match one node, the one filling the most roles wins', () => {
    const planar = normalizeConvention({ id: 'planar', name: 'Planar', symbols: { x: 'x', y: 'y', yaw: 'yaw' } });
    const signals = catalogue({ 1: ['x', 'y', 'z', 'roll', 'pitch', 'yaw'] });
    assert.equal(matchConvention(signals, [planar, defaultConvention]).convention.id, 'konjugate');
    assert.equal(resolveBodies(signals, { conventions: [planar, defaultConvention] }).bodies[0].source.conventionId, 'konjugate');
});

test('the user\'s mapping for a node wins over conventions, and a removed node stays removed', () => {
    const signals = catalogue({ 1: ['x', 'y', 'z', 'roll', 'pitch', 'yaw'], 2: ['angle:deg', 'rate'] });
    const projectData = normalizeProjectData({ bodies: { 1: { excluded: true }, 2: { roles: { pitch: 106 } } } });
    const { bodies, others } = resolveBodies(signals, { projectData });
    assert.deepEqual(bodies.map(({ entityId, roles, source }) => [entityId, roles, source.kind]), [[2, { pitch: 106 }, 'mapping']]);
    assert.deepEqual(others.map(({ entityId }) => entityId), [1]);
});

test('a mapping whose states are gone from the result falls back to what conventions find', () => {
    const signals = catalogue({ 1: ['x', 'y', 'z', 'roll', 'pitch', 'yaw'] });
    const projectData = normalizeProjectData({ bodies: { 1: { roles: { x: 999 } } } });
    const [body] = resolveBodies(signals, { projectData }).bodies;
    assert.equal(body.source.kind, 'convention');
    assert.equal(Object.keys(body.roles).length, 6);
});

test('a 1-DOF hinge turns about the axis its role names, and everything else holds its constant', () => {
    const signals = catalogue({ 1: ['theta'] });
    const projectData = normalizeProjectData({ bodies: { 1: { roles: { yaw: 100 }, constants: { z: 2, roll: 0.25 } } } });
    const [body] = resolveBodies(signals, { conventions: [], projectData }).bodies;
    const pose = poseAt(body, { yaw: constantSeries(0.5) }, 0);
    assert.deepEqual(pose, { x: 0, y: 0, z: 2, roll: 0.25, pitch: 0, yaw: 0.5 });
});

test('a 2-DOF body moves in its plane only', () => {
    const signals = catalogue({ 1: ['x', 'y'] });
    const projectData = normalizeProjectData({ bodies: { 1: { roles: { x: 100, y: 101 } } } });
    const [body] = resolveBodies(signals, { conventions: [], projectData }).bodies;
    assert.deepEqual(poseAt(body, { x: constantSeries(3), y: constantSeries(-4) }, 0.4), { x: 3, y: -4, z: 0, roll: 0, pitch: 0, yaw: 0 });
});

test('angles are read in degrees when the state says so, or when the user chooses degrees', () => {
    const signals = catalogue({ 1: ['heading:°'], 2: ['heading'], 3: ['heading'] });
    const projectData = normalizeProjectData({ bodies: {
        1: { roles: { yaw: 100 } }, 2: { roles: { yaw: 101 } }, 3: { roles: { yaw: 102 }, angleUnit: 'deg', constants: { pitch: 90 } }
    } });
    const [byUnit, byDefault, byChoice] = resolveBodies(signals, { conventions: [], projectData }).bodies;
    near(poseAt(byUnit, { yaw: constantSeries(90) }, 0).yaw, Math.PI / 2);
    near(poseAt(byDefault, { yaw: constantSeries(1) }, 0).yaw, 1);
    const chosen = poseAt(byChoice, { yaw: constantSeries(180) }, 0);
    near(chosen.yaw, Math.PI);
    // A constant angle is in the unit the body chose too.
    near(chosen.pitch, Math.PI / 2);
    assert.equal(describeBody(byUnit, new Map(signals.map((signal) => [signal.signalId, signal]))), 'yaw = heading · deg');
});

test('the sample nearest the requested time is used, ties going to the earlier one', () => {
    const samples = [{ time: 0, value: 1 }, { time: 1, value: 2 }, { time: 2, value: 3 }];
    assert.equal(nearestValue(samples, 0.4), 1);
    assert.equal(nearestValue(samples, 0.5), 1);
    assert.equal(nearestValue(samples, 1.6), 3);
    assert.equal(nearestValue([], 1), 0);
});

test('the rotation is yaw about model z, then pitch about y, then roll about x', () => {
    const turned = modelBodyAxes(0, 0, Math.PI / 2);
    turned.bx.forEach((value, index) => near(value, [0, 1, 0][index]));
    const pitched = modelBodyAxes(0, Math.PI / 2, 0);
    pitched.bx.forEach((value, index) => near(value, [0, 0, -1][index]));
    const rolled = modelBodyAxes(Math.PI / 2, 0, 0);
    rolled.by.forEach((value, index) => near(value, [0, 0, 1][index]));
});

test('a scene moving in one plane starts square on to it; one moving in 3D keeps the corner view', () => {
    const body = (roles) => ({ roles: Object.fromEntries(roles.map((role) => [role, 1])) });
    assert.equal(suggestedView([body(['x'])]), 'front');
    assert.equal(suggestedView([body(['x', 'z', 'pitch'])]), 'front');
    assert.equal(suggestedView([body(['y'])]), 'right');
    assert.equal(suggestedView([body(['roll'])]), 'right');
    assert.equal(suggestedView([body(['x', 'y', 'yaw'])]), 'top');
    assert.equal(suggestedView([body(['yaw'])]), 'top');
    assert.equal(suggestedView([body(['x']), body(['y'])]), 'top');
    assert.equal(suggestedView([body(['x', 'y', 'z'])]), null);
    assert.equal(suggestedView([body(['x', 'yaw', 'roll'])]), null);
    assert.equal(suggestedView([]), null);
});

test('settings read back only well-formed conventions, with the default active until the user says otherwise', () => {
    assert.deepEqual(normalizeSettings(null), { version: 1, conventions: [], activeConventionIds: ['konjugate'] });
    const settings = normalizeSettings({
        conventions: [
            { id: 'planar', name: ' Planar ', symbols: { x: 'px', y: ' py ', yaw: '' } },
            { id: 'twice', name: 'Twice', symbols: { x: 'a', y: 'a' } },
            { id: 'empty', name: 'Empty', symbols: {} },
            { id: 'konjugate', name: 'Impostor', symbols: { x: 'x' } },
            { id: 'planar', name: 'Duplicate', symbols: { x: 'q' } }
        ],
        activeConventionIds: ['planar', 'gone']
    });
    assert.deepEqual(settings.conventions, [{ id: 'planar', name: 'Planar', symbols: { x: 'px', y: 'py' } }]);
    assert.deepEqual(activeConventions(settings).map(({ id }) => id), ['planar']);
});

test('project data keeps only what it can use, by numeric node and signal ids', () => {
    assert.deepEqual(normalizeProjectData({ bodies: {
        1: { roles: { x: 5, wobble: 6, y: 'seven' }, constants: { z: 2, roll: 0, pitch: Number.NaN }, angleUnit: 'grad' },
        2: { excluded: true },
        3: { excluded: true, roles: { x: 9 } },
        abc: { roles: { x: 1 } },
        4: {}
    } }), { version: 1, bodies: {
        1: { roles: { x: 5 }, constants: { z: 2 } },
        2: { excluded: true },
        3: { roles: { x: 9 } }
    } });
    assert.deepEqual(normalizeProjectData(undefined), { version: 1, bodies: {} });
});

// The page's Content Security Policy refuses inline style attributes, so markup written with innerHTML silently lost
// each body's colour swatch -- and put a node's own name into the page as markup.
test('the viewer builds the sidebar with the DOM, never markup strings', async () => {
    const source = await readFile(new URL('../package/viewer.mjs', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML/);
});

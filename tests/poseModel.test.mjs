/* Copyright © 2026 Zenin Easa Panthakkalakath */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    activeConventions, defaultConvention, describeBody, matchConvention, modelBodyAxes, modelBodyAxesFromQuaternion,
    nearestValue, normalizeConvention, normalizeProjectData, normalizeSettings, poseAt, poseBodyAxes, resolveBodies,
    rolesFor, suggestedView
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
    assert.deepEqual(settings.conventions, [{ id: 'planar', name: 'Planar', orientation: 'angles', symbols: { x: 'px', y: 'py' } }]);
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

// --- Quaternions ------------------------------------------------------------------------------------------------

// The quaternion for the ZYX angles modelBodyAxes uses, R = Rz(yaw)*Ry(pitch)*Rx(roll), as [w, x, y, z].
function quaternionFromAngles(roll, pitch, yaw) {
    const [cr, sr] = [Math.cos(roll / 2), Math.sin(roll / 2)];
    const [cp, sp] = [Math.cos(pitch / 2), Math.sin(pitch / 2)];
    const [cy, sy] = [Math.cos(yaw / 2), Math.sin(yaw / 2)];
    return [cr * cp * cy + sr * sp * sy, sr * cp * cy - cr * sp * sy, cr * sp * cy + sr * cp * sy, cr * cp * sy - sr * sp * cy];
}
const sameAxes = (actual, expected, tolerance = 1e-12) => ['bx', 'by', 'bz'].forEach((axis) =>
    actual[axis].forEach((value, index) => near(value, expected[axis][index], tolerance)));

test('a quaternion turns a body exactly as the same rotation in roll, pitch and yaw does', () => {
    for (const [roll, pitch, yaw] of [[0, 0, 0], [0, 0, Math.PI / 2], [0, Math.PI / 2, 0], [Math.PI / 2, 0, 0], [0.3, -1.1, 2.4], [-2.9, 0.7, -0.4]]) {
        sameAxes(modelBodyAxesFromQuaternion(...quaternionFromAngles(roll, pitch, yaw)), modelBodyAxes(roll, pitch, yaw));
    }
});

test('a quaternion of any length or sign gives the same axes, and one of zero length leaves the body unturned', () => {
    const q = quaternionFromAngles(0.3, -1.1, 2.4);
    const expected = modelBodyAxesFromQuaternion(...q);
    sameAxes(modelBodyAxesFromQuaternion(...q.map((value) => value * 2.5)), expected);
    sameAxes(modelBodyAxesFromQuaternion(...q.map((value) => -value)), expected);
    sameAxes(modelBodyAxesFromQuaternion(0, 0, 0, 0), { bx: [1, 0, 0], by: [0, 1, 0], bz: [0, 0, 1] });
    sameAxes(modelBodyAxesFromQuaternion(Number.NaN, 0, 0, 0), { bx: [1, 0, 0], by: [0, 1, 0], bz: [0, 0, 1] });
});

// The reason for quaternions: at a pitch of 90 degrees roll and yaw turn about the same axis, so three angles cannot
// tell them apart, and a solver's angles jump there. A quaternion passing through the same pose stays smooth.
test('a quaternion through a pitch of 90 degrees has no jump, where the three angles lock', () => {
    const steps = 50;
    let previous = null;
    for (let index = 0; index <= steps; index += 1) {
        const pitch = (index / steps) * Math.PI;
        const axes = modelBodyAxesFromQuaternion(Math.cos(pitch / 2), 0.2 * Math.sin(pitch / 2), Math.sin(pitch / 2), 0);
        if (previous) assert.ok(Math.hypot(...axes.bx.map((value, i) => value - previous.bx[i])) < 0.1);
        previous = axes;
    }
    // Locked: at pitch 90 degrees, roll 0.4 with yaw 0 and roll 0 with yaw -0.4 are the same orientation.
    sameAxes(modelBodyAxes(0.4, Math.PI / 2, 0), modelBodyAxes(0, Math.PI / 2, -0.4));
});

const quaternionSeries = (q) => ({ qw: constantSeries(q[0]), qx: constantSeries(q[1]), qy: constantSeries(q[2]), qz: constantSeries(q[3]) });
const byId = (signals) => new Map(signals.map((signal) => [signal.signalId, signal]));

test('a body is turned by a quaternion only when its convention says so, with whatever state names it gives', () => {
    const mujoco = normalizeConvention({ id: 'mujoco', name: 'MuJoCo', orientation: 'quaternion',
        symbols: { x: 'px', y: 'py', z: 'pz', qw: 'q0', qx: 'q1', qy: 'q2', qz: 'q3' } });
    const signals = catalogue({ 1: ['px', 'py', 'pz', 'q0', 'q1', 'q2', 'q3'], 2: ['x', 'y', 'z', 'roll', 'pitch', 'yaw', 'qw', 'qx', 'qy', 'qz'] });
    // States named qw to qz are not taken for a quaternion by themselves: node 2 is the default convention's, by angles.
    const { bodies } = resolveBodies(signals, { conventions: [defaultConvention, mujoco] });
    assert.deepEqual(bodies.map(({ entityId, orientation, source }) => [entityId, orientation, source.conventionId]),
        [[1, 'quaternion', 'mujoco'], [2, 'angles', 'konjugate']]);
    const q = quaternionFromAngles(0, 0, Math.PI / 2);
    const pose = poseAt(bodies[0], { x: constantSeries(1), y: constantSeries(2), z: constantSeries(3), ...quaternionSeries(q) }, 0);
    assert.deepEqual([pose.x, pose.y, pose.z, pose.roll, pose.pitch, pose.yaw], [1, 2, 3, 0, 0, 0]);
    assert.deepEqual(pose.quaternion, q);
    sameAxes(poseBodyAxes(pose), modelBodyAxes(0, 0, Math.PI / 2));
    assert.equal(describeBody(bodies[0], byId(signals)), 'x = px, y = py, z = pz, qw = q0, qx = q1, qy = q2, qz = q3');
    assert.equal(poseAt(bodies[1], {}, 0).quaternion, undefined);
});

test('a node\'s own mapping chooses its orientation, keeping only the roles that orientation uses', () => {
    const signals = catalogue({ 1: ['yaw', 'a', 'b', 'c', 'd:deg'] });
    const projectData = normalizeProjectData({ bodies: { 1: {
        orientation: 'quaternion', roles: { yaw: 100, qw: 101, qx: 102, qy: 103, qz: 104 }, constants: { yaw: 1, qw: 1, z: 2 }
    } } });
    assert.deepEqual(projectData.bodies[1], { roles: { qw: 101, qx: 102, qy: 103, qz: 104 }, orientation: 'quaternion', constants: { z: 2 } });
    const [body] = resolveBodies(signals, { conventions: [], projectData }).bodies;
    assert.equal(body.orientation, 'quaternion');
    sameAxes(poseBodyAxes(poseAt(body, quaternionSeries([1, 0, 0, 0]), 0)), modelBodyAxes(0, 0, 0));
    // A quaternion is unitless: a state marked in degrees does not make it read as degrees.
    assert.equal(describeBody(body, byId(signals)), 'qw = a, qx = b, qy = c, qz = d');
    assert.equal(suggestedView([body]), null);

    // The same mapping by angles keeps yaw and drops the quaternion.
    const byAngles = normalizeProjectData({ bodies: { 1: { roles: { yaw: 100, qw: 101 } } } });
    assert.deepEqual(byAngles.bodies[1], { roles: { yaw: 100 } });
    const [turned] = resolveBodies(signals, { conventions: [], projectData: byAngles }).bodies;
    assert.equal(turned.orientation, 'angles');
    sameAxes(poseBodyAxes(poseAt(turned, { yaw: constantSeries(Math.PI / 2) }, 0)), modelBodyAxes(0, 0, Math.PI / 2));
});

test('a body turned by a quaternion stays unturned until all four of its states are chosen', () => {
    const signals = catalogue({ 1: ['p', 'a', 'b'] });
    const projectData = normalizeProjectData({ bodies: { 1: { orientation: 'quaternion', roles: { x: 100, qw: 101, qx: 102 } } } });
    const [body] = resolveBodies(signals, { conventions: [], projectData }).bodies;
    const pose = poseAt(body, { x: constantSeries(4), qw: constantSeries(0), qx: constantSeries(1) }, 0);
    assert.equal(pose.x, 4);
    assert.deepEqual(pose.quaternion, [1, 0, 0, 0]);
    assert.equal(suggestedView([body]), 'front');
});

test('a convention takes the names of its own orientation only, and a quaternion whole or not at all', () => {
    assert.deepEqual(normalizeConvention({ id: 'mixed', name: 'Mixed', orientation: 'quaternion',
        symbols: { x: 'px', yaw: 'h', qw: 'a', qx: 'b', qy: 'c', qz: 'd' } }),
    { id: 'mixed', name: 'Mixed', orientation: 'quaternion', symbols: { x: 'px', qw: 'a', qx: 'b', qy: 'c', qz: 'd' } });
    assert.deepEqual(normalizeConvention({ id: 'angles', name: 'Angles', symbols: { yaw: 'h', qw: 'a' } }).symbols, { yaw: 'h' });
    assert.equal(normalizeConvention({ id: 'part', name: 'Part', orientation: 'quaternion', symbols: { qw: 'a', qx: 'b', qy: 'c' } }), null);
    assert.equal(normalizeConvention({ id: 'konjugate', name: 'Impostor', orientation: 'quaternion', symbols: { x: 'x' } }), null);
    assert.deepEqual(rolesFor('quaternion').map(({ role }) => role), ['x', 'y', 'z', 'qw', 'qx', 'qy', 'qz']);
    assert.deepEqual(rolesFor('anything else').map(({ role }) => role), ['x', 'y', 'z', 'roll', 'pitch', 'yaw']);
});

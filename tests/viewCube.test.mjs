/* Copyright © 2026 Zenin Easa Panthakkalakath */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as THREE from '../package/vendor/three.module.js';
import {
    activeFace, faceDirections, fitOrbit, interpolateOrbit, maximumRadius, minimumPolar, minimumRadius,
    orbitAnglesFor, panOffset, panStepPixels, zoomedRadius
} from '../package/viewCamera.mjs';

// Where updateCameraFromOrbit (viewer.mjs) puts the camera for these angles, as a unit direction from the target.
const directionFor = ({ azimuth, polar }) => new THREE.Vector3(
    Math.sin(polar) * Math.sin(azimuth), Math.cos(polar), Math.sin(polar) * Math.cos(azimuth));
const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

test('every face of the cube turns the camera to look from that side', () => {
    for (const [name, direction] of Object.entries(faceDirections)) {
        const looking = directionFor(orbitAnglesFor(direction));
        // Top and bottom are held a hair off the pole, so they match to within the polar limit, not exactly.
        assert.ok(looking.dot(direction) > Math.cos(minimumPolar) - 1e-9, `${name}: ${looking.toArray()}`);
        assert.equal(activeFace(looking), name);
    }
});

test('the faces are the same directions as Konjugate\'s own view cube', () => {
    assert.deepEqual(Object.fromEntries(Object.entries(faceDirections).map(([name, vector]) => [name, vector.toArray()])), {
        front: [0, 0, 1], back: [0, 0, -1], right: [1, 0, 0], left: [-1, 0, 0], top: [0, 1, 0], bottom: [0, -1, 0]
    });
});

test('top and bottom face their screen-up toward -Z and +Z, as the editor\'s cube does', () => {
    near(orbitAnglesFor(faceDirections.top).azimuth, 0);
    near(orbitAnglesFor(faceDirections.bottom).azimuth, 0);
    const camera = new THREE.PerspectiveCamera();
    for (const [view, expectedUpZ] of [['top', -1], ['bottom', 1]]) {
        camera.position.copy(directionFor(orbitAnglesFor(faceDirections[view])).multiplyScalar(10));
        camera.lookAt(0, 0, 0);
        camera.updateMatrix();
        assert.equal(Math.sign(new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1).z), expectedUpZ, view);
    }
});

test('each corner looks from that corner', () => {
    for (const x of [1, -1]) for (const y of [1, -1]) for (const z of [1, -1]) {
        const corner = new THREE.Vector3(x, y, z);
        const looking = directionFor(orbitAnglesFor(corner));
        assert.ok(looking.dot(corner.clone().normalize()) > 1 - 1e-9, corner.toArray().join());
    }
});

test('a transition between views takes the shorter way round and ends where it is going', () => {
    const from = { azimuth: 0, polar: 1.2, radius: 8, target: new THREE.Vector3() };
    const to = { azimuth: -Math.PI / 2, polar: Math.PI / 2, radius: 8, target: new THREE.Vector3(1, 2, 3) };
    const halfway = interpolateOrbit(from, to, 0.5);
    assert.ok(halfway.azimuth < 0 && halfway.azimuth > -Math.PI / 2, 'turns toward Left, not the long way');
    assert.deepEqual(interpolateOrbit(from, to, 1).target.toArray(), [1, 2, 3]);
    near(interpolateOrbit(from, to, 1).azimuth, -Math.PI / 2);
    near(interpolateOrbit(from, to, 0).polar, 1.2);
    const aroundTheBack = interpolateOrbit({ ...from, azimuth: 3 }, { ...to, azimuth: -3 }, 1);
    near(Math.cos(aroundTheBack.azimuth), Math.cos(-3));
    assert.ok(Math.abs(aroundTheBack.azimuth - 3) < 0.5, 'goes through ±π, a short turn, not back through 0');
});

test('Fit frames the bounds with a margin, and does nothing when there are none', () => {
    assert.equal(fitOrbit(new THREE.Box3(), 50, 1.5), null);
    const bounds = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    const fit = fitOrbit(bounds, 50, 1.5);
    assert.deepEqual(fit.target.toArray(), [0, 0, 0]);
    const radius = Math.sqrt(3);
    const expected = radius / Math.sin(THREE.MathUtils.degToRad(50) / 2) * 1.15;
    near(fit.radius, expected);
    // A narrow window is limited by its width, so the same bounds need more distance.
    assert.ok(fitOrbit(bounds, 50, 0.5).radius > fit.radius);
    assert.equal(fitOrbit(new THREE.Box3(new THREE.Vector3(), new THREE.Vector3()), 50, 1).radius, minimumRadius);
    const huge = new THREE.Box3(new THREE.Vector3(-1e6, 0, 0), new THREE.Vector3(1e6, 1, 1));
    assert.equal(fitOrbit(huge, 50, 1).radius, maximumRadius);
});

test('the pan pad moves the target along the camera\'s own axes, farther when zoomed out', () => {
    const right = new THREE.Vector3(1, 0, 0);
    const up = new THREE.Vector3(0, 1, 0);
    const options = { radius: 10, verticalFovDegrees: 50, viewportHeight: 600, right, up };
    const perPixel = 2 * 10 * Math.tan(THREE.MathUtils.degToRad(25)) / 600;
    near(panOffset({ ...options, direction: 'up' }).y, panStepPixels * perPixel);
    near(panOffset({ ...options, direction: 'down' }).y, -panStepPixels * perPixel);
    near(panOffset({ ...options, direction: 'right' }).x, panStepPixels * perPixel);
    near(panOffset({ ...options, direction: 'left' }).x, -panStepPixels * perPixel);
    near(panOffset({ ...options, radius: 20, direction: 'up' }).y, 2 * panStepPixels * perPixel);
    assert.ok(Number.isFinite(panOffset({ ...options, viewportHeight: 0, direction: 'up' }).y));
});

test('zoom in and out are inverses, and stop at the limits', () => {
    near(zoomedRadius(zoomedRadius(10, 'in'), 'out'), 10);
    assert.ok(zoomedRadius(10, 'in') < 10 && zoomedRadius(10, 'out') > 10);
    assert.equal(zoomedRadius(minimumRadius, 'in'), minimumRadius);
    assert.equal(zoomedRadius(maximumRadius, 'out'), maximumRadius);
});

test('no face is lit when the camera looks between them', () => {
    assert.equal(activeFace(new THREE.Vector3(1, 1, 1)), null);
    assert.equal(activeFace(new THREE.Vector3(0, 0, 5)), 'front');
});

test('the page has every control the view cube needs, wired to the code, and no inline styles the CSP would block', async () => {
    const [html, viewer, css] = await Promise.all(['index.html', 'viewer.mjs', 'styles.css'].map((name) => readFile(new URL(`../package/${name}`, import.meta.url), 'utf8')));
    for (const view of Object.keys(faceDirections)) assert.ok(html.includes(`data-nav-view="${view}"`), view);
    assert.equal([...html.matchAll(/data-nav-corner="/g)].length, 8);
    for (const direction of ['up', 'down', 'left', 'right']) assert.ok(html.includes(`data-nav-pan="${direction}"`), direction);
    for (const action of ['zoomIn', 'zoomOut', 'fit']) assert.ok(html.includes(`data-nav-action="${action}"`), action);
    for (const hook of ['[data-nav-view]', '[data-nav-corner]', '[data-nav-pan]', '[data-nav-action="fit"]', '[data-nav-action="zoomIn"]', '[data-nav-action="zoomOut"]']) {
        assert.ok(viewer.includes(hook), `${hook} has no handler`);
    }
    // The page's CSP is style-src 'self': a style attribute in the markup would be refused.
    assert.ok(!/\sstyle=/.test(html));
    assert.ok(css.includes('.viewCube {') && css.includes('--accent'));
});

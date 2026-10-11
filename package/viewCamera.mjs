/* Copyright © 2026 Zenin Easa Panthakkalakath */

// The camera maths behind the view cube, kept apart from the page so it can be tested. The cube is the
// one in Konjugate's own editor and works the same way: a face looks at the scene from that side, a
// corner looks from that corner, the pan pad moves the view in steps, and Fit frames what is shown.
// Directions are in this scene's own space (Y up), the same space the editor's cube uses, so "Top"
// looks down from above and "Front" looks from the +Z side here exactly as it does there.

import * as THREE from './vendor/three.module.js';

export const minimumPolar = 0.05;
export const minimumRadius = 0.5;
export const maximumRadius = 200;
export const panStepPixels = 36;
export const zoomFactor = 0.8;
export const transitionMilliseconds = 650;

export const faceDirections = Object.freeze({
    front: new THREE.Vector3(0, 0, 1),
    back: new THREE.Vector3(0, 0, -1),
    right: new THREE.Vector3(1, 0, 0),
    left: new THREE.Vector3(-1, 0, 0),
    top: new THREE.Vector3(0, 1, 0),
    bottom: new THREE.Vector3(0, -1, 0)
});

const clampRadius = (radius) => THREE.MathUtils.clamp(radius, minimumRadius, maximumRadius);

// The orbit angles (see updateCameraFromOrbit in viewer.mjs) of a camera that looks at the target from
// `direction`. Straight above or below is held a hair off the pole, where the orbit's own polar limit
// keeps it, and faces its screen-up toward -Z (top) or +Z (bottom), as the editor's cube does.
export function orbitAnglesFor(direction) {
    const unit = direction.clone().normalize();
    return {
        polar: THREE.MathUtils.clamp(Math.acos(THREE.MathUtils.clamp(unit.y, -1, 1)), minimumPolar, Math.PI - minimumPolar),
        azimuth: Math.atan2(unit.x, unit.z)
    };
}

// Where a transition from one orbit state to another is `progress` (0 to 1) of the way, eased out. The
// azimuth takes the shorter way round, so turning from Front to Left never swings through Back.
export function interpolateOrbit(from, to, progress) {
    const eased = 1 - Math.pow(1 - THREE.MathUtils.clamp(progress, 0, 1), 3);
    const turn = to.azimuth - from.azimuth;
    return {
        azimuth: from.azimuth + Math.atan2(Math.sin(turn), Math.cos(turn)) * eased,
        polar: from.polar + (to.polar - from.polar) * eased,
        radius: from.radius + (to.radius - from.radius) * eased,
        target: from.target.clone().lerp(to.target, eased)
    };
}

// The target and distance that frame `bounds` in a view of this size, with a margin. Null when nothing
// is there to frame.
export function fitOrbit(bounds, verticalFovDegrees, aspect) {
    if (bounds.isEmpty()) return null;
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const vertical = THREE.MathUtils.degToRad(verticalFovDegrees);
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
    const limiting = Math.min(vertical, horizontal);
    return { target: sphere.center.clone(), radius: clampRadius(sphere.radius / Math.sin(limiting / 2) * 1.15) };
}

// How far one pan-pad press moves the target: a fixed number of screen pixels, converted to scene
// units at the target's distance, along the camera's own right and up directions.
export function panOffset({ direction, radius, verticalFovDegrees, viewportHeight, right, up }) {
    const perPixel = 2 * radius * Math.tan(THREE.MathUtils.degToRad(verticalFovDegrees) / 2) / Math.max(1, viewportHeight);
    const amount = panStepPixels * perPixel;
    if (direction === 'up') return up.clone().multiplyScalar(amount);
    if (direction === 'down') return up.clone().multiplyScalar(-amount);
    if (direction === 'left') return right.clone().multiplyScalar(-amount);
    return right.clone().multiplyScalar(amount);
}

export function zoomedRadius(radius, direction) {
    return clampRadius(direction === 'in' ? radius * zoomFactor : radius / zoomFactor);
}

// The face the camera is looking straight at, within a few degrees, or null: the cube highlights it.
export function activeFace(cameraDirection) {
    const unit = cameraDirection.clone().normalize();
    return Object.entries(faceDirections).find(([, direction]) => unit.dot(direction) > 0.985)?.[0] ?? null;
}

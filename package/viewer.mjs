/* Copyright © 2026 Zenin Easa Panthakkalakath */

import * as THREE from './vendor/three.module.js';
import {
    activeFace, faceDirections, fitOrbit, interpolateOrbit, orbitAnglesFor, panOffset, transitionMilliseconds, zoomedRadius
} from './viewCamera.mjs';
import {
    activeConventions, allConventions, describeBody, hasQuaternion, matchConvention, normalizeConvention, normalizeOrientation,
    normalizeProjectData, normalizeSettings, orientations, poseAt, poseBodyAxes, poseRoles, quaternionRoles, resolveBodies,
    rolesFor, suggestedView
} from './poseModel.mjs';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const bridge = window.konjugateVisualizer;
const bodyPalette = ['#42c9bc', '#e0a458', '#c084d8', '#6fa8dc', '#e07a7a', '#7ad48c', '#d8c05a', '#8f8fe0'];

let context = null;
let signals = [];
let signalsById = new Map();
// The user's naming conventions (kept for the user, in every project) and this project's own choices per node (kept
// with the project): see poseModel.mjs.
let settings = normalizeSettings(null);
let projectData = normalizeProjectData(null);
let bodies = [];
// Nodes in the result that aren't bodies, which the user may make one.
let otherNodes = [];
// The body whose roles are open for editing in the sidebar, and the convention being written, if any.
let editingEntityId = null;
let conventionDraft = null;
let viewSuggested = false;
let hiddenBodyIds = new Set();
let nodesById = new Map();
let edgesForBodies = [];
let useEditorShapes = false;
let showConnections = false;
let edgeLines = [];

function formatTime(time) {
    return `${Number(time).toLocaleString(undefined, { maximumSignificantDigits: 6 })} s`;
}

// --- Scene setup -------------------------------------------------------------------------

const canvas = $('#scene');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#081119');
const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 2000);
camera.position.set(4, 3, 6);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// Three.js's own OrbitControls (examples/jsm) imports the library via the bare specifier
// "three", which only resolves through an import map -- and an inline importmap needs
// 'unsafe-inline' in script-src, which this add-on's CSP deliberately withholds. A small
// hand-rolled orbit-around-target control sidesteps that dependency entirely.
const orbit = { target: new THREE.Vector3(0, 0, 0), radius: camera.position.length(), azimuth: Math.atan2(camera.position.x, camera.position.z), polar: Math.acos(THREE.MathUtils.clamp(camera.position.y / camera.position.length(), -1, 1)) };
function updateCameraFromOrbit() {
    const sinPolar = Math.sin(orbit.polar);
    camera.position.set(
        orbit.target.x + orbit.radius * sinPolar * Math.sin(orbit.azimuth),
        orbit.target.y + orbit.radius * Math.cos(orbit.polar),
        orbit.target.z + orbit.radius * sinPolar * Math.cos(orbit.azimuth)
    );
    camera.lookAt(orbit.target);
}
updateCameraFromOrbit();
let dragging = false;
let lastPointer = { x: 0, y: 0 };
canvas.addEventListener('pointerdown', (event) => {
    cameraAnimation = null;
    dragging = true;
    lastPointer = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointerup', (event) => { dragging = false; canvas.releasePointerCapture(event.pointerId); });
canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    orbit.azimuth -= (event.clientX - lastPointer.x) * 0.008;
    orbit.polar = THREE.MathUtils.clamp(orbit.polar - (event.clientY - lastPointer.y) * 0.008, 0.05, Math.PI - 0.05);
    lastPointer = { x: event.clientX, y: event.clientY };
    updateCameraFromOrbit();
});
canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    cameraAnimation = null;
    orbit.radius = THREE.MathUtils.clamp(orbit.radius * (1 + Math.sign(event.deltaY) * 0.1), 0.5, 200);
    updateCameraFromOrbit();
}, { passive: false });

// --- View cube -----------------------------------------------------------------------------
//
// The same widget as in Konjugate's editor: faces and corners turn the view, the pad pans it, and
// Fit frames the bodies being shown (viewCamera.mjs has the maths). Turning keeps the current target
// and distance; only Fit changes what the view is centred on.
let cameraAnimation = null;

function animateOrbitTo(destination) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        cameraAnimation = null;
        Object.assign(orbit, { azimuth: destination.azimuth, polar: destination.polar, radius: destination.radius });
        orbit.target.copy(destination.target);
        updateCameraFromOrbit();
        return;
    }
    cameraAnimation = {
        startedAt: performance.now(),
        from: { azimuth: orbit.azimuth, polar: orbit.polar, radius: orbit.radius, target: orbit.target.clone() },
        to: destination
    };
}

function stepCameraAnimation(time) {
    if (!cameraAnimation) return;
    const progress = Math.min(1, (time - cameraAnimation.startedAt) / transitionMilliseconds);
    const frame = interpolateOrbit(cameraAnimation.from, cameraAnimation.to, progress);
    Object.assign(orbit, { azimuth: frame.azimuth, polar: frame.polar, radius: frame.radius });
    orbit.target.copy(frame.target);
    updateCameraFromOrbit();
    if (progress === 1) cameraAnimation = null;
}

function turnTo(direction) {
    animateOrbitTo({ ...orbitAnglesFor(direction), radius: orbit.radius, target: orbit.target.clone() });
}

function bodyBounds() {
    const bounds = new THREE.Box3();
    bodies.forEach((body) => {
        if (body.object3D?.visible) bounds.expandByObject(body.object3D);
    });
    return bounds;
}

function fitView() {
    const fit = fitOrbit(bodyBounds(), camera.fov, camera.aspect);
    if (!fit) return;
    animateOrbitTo({ azimuth: orbit.azimuth, polar: orbit.polar, radius: fit.radius, target: fit.target });
}

$$('[data-nav-view]').forEach((button) => button.addEventListener('click', () => turnTo(faceDirections[button.dataset.navView])));
$$('[data-nav-corner]').forEach((button) => button.addEventListener('click', () => {
    turnTo(new THREE.Vector3(...button.dataset.navCorner.split(',').map(Number)));
}));
$('[data-nav-action="fit"]').addEventListener('click', fitView);
$('[data-nav-action="zoomIn"]').addEventListener('click', () => {
    cameraAnimation = null;
    orbit.radius = zoomedRadius(orbit.radius, 'in');
    updateCameraFromOrbit();
});
$('[data-nav-action="zoomOut"]').addEventListener('click', () => {
    cameraAnimation = null;
    orbit.radius = zoomedRadius(orbit.radius, 'out');
    updateCameraFromOrbit();
});
$$('[data-nav-pan]').forEach((button) => button.addEventListener('click', () => {
    cameraAnimation = null;
    const rect = canvas.parentElement.getBoundingClientRect();
    orbit.target.add(panOffset({
        direction: button.dataset.navPan,
        radius: orbit.radius,
        verticalFovDegrees: camera.fov,
        viewportHeight: rect.height,
        right: new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0),
        up: new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1)
    }));
    updateCameraFromOrbit();
}));

// Spins the cube to show the world from where the camera is, and lights the face it looks straight at.
function updateViewCube() {
    const worldRotation = new THREE.Matrix4().makeRotationFromQuaternion(camera.quaternion.clone().invert());
    const flipCssY = new THREE.Matrix4().makeScale(1, -1, 1);
    const cssRotation = flipCssY.clone().multiply(worldRotation).multiply(flipCssY);
    $('#viewCubeObject').style.transform = `matrix3d(${cssRotation.elements.join(',')})`;
    const facing = activeFace(camera.position.clone().sub(orbit.target));
    $$('.cubeFace').forEach((face) => face.classList.toggle('active', face.dataset.navView === facing));
}


scene.add(new THREE.HemisphereLight('#cfe8ff', '#0a1018', 1.15));
const keyLight = new THREE.DirectionalLight('#ffffff', 0.85);
keyLight.position.set(5, 8, 6);
scene.add(keyLight);
scene.add(new THREE.GridHelper(20, 20, '#2a3d47', '#182530'));

const edgeLineGroup = new THREE.Group();
scene.add(edgeLineGroup);

function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    renderer.setSize(rect.width, rect.height, false);
}
new ResizeObserver(resize).observe(canvas.parentElement);
resize();

function animate() {
    requestAnimationFrame(animate);
    stepCameraAnimation(performance.now());
    updateViewCube();
    refreshEdgeLabelPositions();
    renderer.render(scene, camera);
}
animate();

// --- Model-space (Z-up, right-handed) to Three.js-space (Y-up, right-handed) -------------
//
// Every kinematic relationship built for this app's example library (the four-bar linkage,
// the quadrotor kinematics design) treats x/y as a ground plane and z as "up", following
// ordinary robotics/CAD convention. Three.js renders Y-up. Mapping model (x,y,z) to three.js
// (x,z,-y) is the unique axis relabelling that sends model-Z to three.js-Y while keeping both
// systems right-handed (verified: if model X×Y=Z, then three.X×three.Y = model.X×model.Z =
// -model.Y = three.Z, matching three.js's own X×Y=Z convention). Every position and every
// orientation basis vector goes through this exact same mapping, so nothing here is rendered
// mirrored or left-handed.
function toThreeVector(modelXyz) {
    const [x, y, z] = modelXyz;
    return new THREE.Vector3(x, z, -y);
}

// --- Body construction --------------------------------------------------------------

// Editor-assigned appearance uses whatever units the model/CAD import happened to be authored
// in -- a primitive sized for the main canvas's own layout scale, or an STL/STEP import in
// arbitrary real-world units -- neither of which relates to this add-on's real simulated
// x/y/z motion scale. Every editor shape is normalized to the same on-screen footprint as the
// default box (targetBodyExtent) so bodies stay visually comparable regardless of source.
const targetBodyExtent = 0.4;

function primitiveGeometry(shape) {
    if (shape === 'cylinder') return new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
    if (shape === 'sphere') return new THREE.SphereGeometry(0.5, 24, 18);
    return new THREE.BoxGeometry(1, 1, 1);
}

// Mirrors the main canvas's own geometryFromDocument -- the mesh document (flat position/
// normal/index arrays) is already fully tessellated by the time it reaches here, whether it
// came from the shape library or an imported STL/STEP file, so no CAD or STL parsing is
// needed on this side at all.
function geometryFromMeshDocument(mesh) {
    if (!mesh?.position?.length) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.position, 3));
    if (mesh.normal?.length) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normal, 3));
    else geometry.computeVertexNormals();
    if (mesh.index?.length) geometry.setIndex(mesh.index);
    return geometry;
}

function normalizedGeometry(geometry) {
    geometry.computeBoundingBox();
    const size = new THREE.Vector3();
    geometry.boundingBox.getSize(size);
    const largest = Math.max(size.x, size.y, size.z, 1e-6);
    geometry.scale(targetBodyExtent / largest, targetBodyExtent / largest, targetBodyExtent / largest);
    geometry.center();
    return geometry;
}

function bodyGeometryAndColor(body) {
    const node = useEditorShapes ? nodesById.get(body.entityId) : null;
    if (!node) return { geometry: new THREE.BoxGeometry(0.3, 0.18, 0.42), color: body.color, rotation: [0, 0, 0], scale: [1, 1, 1] };
    const meshGeometry = node.mesh ? geometryFromMeshDocument(node.mesh) : null;
    const geometry = meshGeometry ? normalizedGeometry(meshGeometry) : primitiveGeometry(node.shape).scale(targetBodyExtent, targetBodyExtent, targetBodyExtent);
    return { geometry, color: node.color, rotation: node.rotation ?? [0, 0, 0], scale: node.scale ?? [1, 1, 1] };
}

// The node's editor-authored rotation/scale is a cosmetic *local* offset -- how the shape sits
// and sizes relative to its own origin on the main canvas -- not part of the live simulated
// pose. It's authored directly in the main canvas's own three.js (Y-up) scene, the same
// convention this add-on's scene already uses, so it composes as a nested child group rather
// than going through the model-space-to-three.js remap that applyPose uses for the live pose:
// the outer group carries the live position/orientation, this inner group carries the static
// editor offset.
function buildBodyObject(body) {
    const group = new THREE.Group();
    const { geometry, color, rotation, scale } = bodyGeometryAndColor(body);
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1 });
    const shape = new THREE.Group();
    shape.rotation.fromArray(rotation);
    shape.scale.fromArray(scale);
    shape.add(new THREE.Mesh(geometry, material));
    group.add(shape);
    group.add(new THREE.AxesHelper(0.4));
    scene.add(group);
    body.material = material;
    return group;
}

function rebuildBodyObjects() {
    bodies.forEach((body) => {
        if (body.object3D) {
            scene.remove(body.object3D);
            body.object3D.traverse((child) => {
                child.geometry?.dispose();
                child.material?.dispose();
            });
        }
        body.object3D = buildBodyObject(body);
        if (body.object3D) body.object3D.visible = !hiddenBodyIds.has(body.entityId);
    });
    applyAllPoses(context?.time ?? 0);
    applySelection(context?.selectedNodeId ?? null);
    buildEdgeLines();
}

$('#useEditorShapes').addEventListener('change', (event) => {
    useEditorShapes = event.target.checked;
    rebuildBodyObjects();
});
$('#showConnections').addEventListener('change', (event) => {
    showConnections = event.target.checked;
    buildEdgeLines();
});

// --- Edges between detected bodies -----------------------------------------------------
//
// An edge only means "one equation reads/writes across these two nodes" -- not necessarily a
// physical joint -- so this deliberately only draws a line when BOTH endpoints are themselves
// bodies (never a partial/guessed connection), and always labels the line with
// the edge's own name so it reads as "relationship X between these two", not an unqualified
// claim of physical connection.

function clearEdgeLines() {
    edgeLines.forEach(({ line, label }) => {
        edgeLineGroup.remove(line);
        line.geometry.dispose();
        line.material.dispose();
        label.remove();
    });
    edgeLines = [];
}

function buildEdgeLines() {
    clearEdgeLines();
    if (!showConnections) return;
    const bodyByEntityId = new Map(bodies.map((body) => [body.entityId, body]));
    edgesForBodies.forEach((edge) => {
        const sourceBody = bodyByEntityId.get(edge.sourceNodeId);
        const targetBody = bodyByEntityId.get(edge.targetNodeId);
        if (!sourceBody?.object3D || !targetBody?.object3D) return;
        const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#e0a458' }));
        edgeLineGroup.add(line);
        const label = document.createElement('div');
        label.className = 'edgeLabel';
        label.textContent = edge.title;
        $('#edgeLabels').appendChild(label);
        edgeLines.push({ sourceBody, targetBody, line, label });
    });
    refreshEdgeGeometry();
}

function refreshEdgeGeometry() {
    edgeLines.forEach(({ sourceBody, targetBody, line }) => {
        const visible = isEdgeVisible(sourceBody, targetBody);
        line.visible = visible;
        if (!visible) return;
        const positions = line.geometry.attributes.position;
        positions.setXYZ(0, sourceBody.object3D.position.x, sourceBody.object3D.position.y, sourceBody.object3D.position.z);
        positions.setXYZ(1, targetBody.object3D.position.x, targetBody.object3D.position.y, targetBody.object3D.position.z);
        positions.needsUpdate = true;
    });
}

function isEdgeVisible(sourceBody, targetBody) {
    return sourceBody.object3D.visible && targetBody.object3D.visible;
}

function refreshEdgeLabelPositions() {
    const rect = canvas.getBoundingClientRect();
    edgeLines.forEach(({ sourceBody, targetBody, label }) => {
        if (!isEdgeVisible(sourceBody, targetBody)) { label.style.display = 'none'; return; }
        const midpoint = new THREE.Vector3().addVectors(sourceBody.object3D.position, targetBody.object3D.position).multiplyScalar(0.5);
        const projected = midpoint.project(camera);
        const onScreen = projected.z < 1 && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1;
        label.style.display = onScreen ? 'block' : 'none';
        if (!onScreen) return;
        label.style.left = `${((projected.x + 1) / 2) * rect.width}px`;
        label.style.top = `${((1 - projected.y) / 2) * rect.height}px`;
    });
}

function applySelection(selectedNodeId) {
    bodies.forEach((body) => {
        body.material?.emissive.set(body.entityId === selectedNodeId ? '#ffffff' : '#000000');
        if (body.material) body.material.emissiveIntensity = 0.35;
    });
    document.querySelectorAll('.bodyOption').forEach((option) => {
        option.classList.toggle('selectedEntity', Number(option.dataset.entityId) === selectedNodeId);
    });
}

// --- Data loading and playback ------------------------------------------------------

async function loadSeriesFor(body) {
    const mapped = Object.entries(body.roles);
    const series = await bridge.readSeries(mapped.map(([, signalId]) => signalId), { maxPoints: 20000 });
    body.series = Object.fromEntries(mapped.map(([role, signalId]) => [role, series.find((entry) => entry.signalId === signalId)?.samples ?? []]));
}

function applyPose(body, time) {
    if (!body.object3D) return;
    const pose = poseAt(body, body.series, time);
    body.object3D.position.copy(toThreeVector([pose.x, pose.y, pose.z]));
    const { bx, by, bz } = poseBodyAxes(pose);
    const basis = new THREE.Matrix4().makeBasis(toThreeVector(bx), toThreeVector(by), toThreeVector(bz));
    body.object3D.quaternion.setFromRotationMatrix(basis);
}

function applyAllPoses(time) {
    bodies.forEach((body) => applyPose(body, time));
    refreshEdgeGeometry();
}

// --- Sidebar -------------------------------------------------------------------------
//
// Built with the DOM rather than markup strings: node names are the user's own text, and the page's Content Security
// Policy refuses inline style attributes, so a colour is set through the element's style instead.

function element(tag, { className, text, attributes = {} } = {}, children = []) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    node.append(...children);
    return node;
}

function swatch(color) {
    const node = element('i', { className: 'bodySwatch' });
    node.style.background = color;
    return node;
}

function sourceLabel(body) {
    return body.source.kind === 'mapping' ? 'Your mapping' : `${body.source.conventionName} names`;
}

function renderBodyList() {
    const container = $('#bodies');
    container.replaceChildren();
    $('#noBodies').hidden = Boolean(bodies.length);
    $('.sceneWorkspace').classList.toggle('hasBodies', Boolean(bodies.length));
    bodies.forEach((body) => {
        const row = element('div', { className: 'bodyRow' });
        const label = element('label', { className: 'bodyOption' });
        label.style.setProperty('--body-color', body.color);
        label.dataset.entityId = body.entityId;
        const input = element('input', { attributes: { type: 'checkbox', 'aria-label': `Show ${body.entityName}` } });
        input.checked = !hiddenBodyIds.has(body.entityId);
        input.addEventListener('change', () => {
            if (input.checked) hiddenBodyIds.delete(body.entityId);
            else hiddenBodyIds.add(body.entityId);
            if (body.object3D) body.object3D.visible = input.checked;
            refreshEdgeGeometry();
        });
        const name = element('b', {}, [swatch(body.color), body.entityName]);
        const hint = element('small', { text: describeBody(body, signalsById), attributes: { title: sourceLabel(body) } });
        label.append(input, element('span', {}, [name, hint]));
        const editing = editingEntityId === body.entityId;
        const edit = element('button', { className: 'iconButton', text: editing ? 'Done' : 'Edit', attributes: { type: 'button', 'aria-expanded': String(editing), title: `Choose which states move ${body.entityName}` } });
        edit.addEventListener('click', () => {
            editingEntityId = editing ? null : body.entityId;
            renderBodyList();
        });
        row.append(label, edit);
        if (editing) row.append(bodyEditor(body));
        container.appendChild(row);
    });
    renderAddBody();
    applySelection(context?.selectedNodeId ?? null);
}

// The choice kept with the project for one node, made if it has none yet.
function choiceFor(entityId) {
    projectData.bodies[entityId] ??= {};
    return projectData.bodies[entityId];
}

// The roles a node would start with for an orientation: whatever its states are named in a convention of that
// orientation (any convention, active or not), keeping the positions it already has.
function startingRoles(nodeSignals, orientation, positions = {}) {
    const bySymbol = new Map(nodeSignals.map((signal) => [signal.symbol, signal]));
    const usable = new Set(rolesFor(orientation).map(({ role }) => role));
    const roles = { ...positions };
    for (const convention of allConventions(settings)) {
        if (normalizeOrientation(convention.orientation) !== orientation) continue;
        for (const [role, symbol] of Object.entries(convention.symbols)) {
            if (usable.has(role) && !(role in roles) && bySymbol.has(symbol)) roles[role] = bySymbol.get(symbol).signalId;
        }
    }
    return roles;
}

// How the body is turned, then a role select and, for an unmapped position or angle, the constant it holds -- one row
// per role its orientation uses. A quaternion role has no constant: a quaternion is all four states or none.
function bodyEditor(body) {
    const editor = element('div', { className: 'bodyEditor' });
    const nodeSignals = signals.filter((signal) => signal.entityId === body.entityId);
    const anyDegrees = body.angleUnit === 'deg';
    const turnedBy = element('select', { attributes: { 'aria-label': `How ${body.entityName} is turned` } },
        orientations.map(({ orientation, label }) => element('option', { text: `Turned by ${label.toLowerCase()}`, attributes: { value: orientation } })));
    turnedBy.value = body.orientation;
    turnedBy.addEventListener('change', () => {
        const orientation = normalizeOrientation(turnedBy.value);
        const positions = Object.fromEntries(Object.entries(body.roles).filter(([role]) => ['x', 'y', 'z'].includes(role)));
        const roles = startingRoles(nodeSignals, orientation, positions);
        const choice = choiceFor(body.entityId);
        delete choice.excluded;
        // A node with nothing to map yet keeps its first state as x, so it stays a body while the rest is chosen.
        choice.roles = Object.keys(roles).length ? roles : { x: nodeSignals[0].signalId };
        if (orientation === 'quaternion') choice.orientation = orientation; else delete choice.orientation;
        saveProjectData();
    });
    editor.append(turnedBy);
    for (const { role, label, kind } of rolesFor(body.orientation)) {
        const select = element('select', { attributes: { 'aria-label': `${label} of ${body.entityName}` } });
        select.append(element('option', { text: kind === 'quaternion' ? 'Not used' : 'Constant', attributes: { value: '' } }));
        for (const signal of nodeSignals) {
            select.append(element('option', { text: `${signal.symbol}${signal.unit ? ` (${signal.unit})` : ''}`, attributes: { value: String(signal.signalId) } }));
        }
        select.value = role in body.roles ? String(body.roles[role]) : '';
        select.addEventListener('change', () => {
            const roles = { ...body.roles };
            if (select.value) roles[role] = Number(select.value); else delete roles[role];
            const choice = choiceFor(body.entityId);
            if (Object.keys(roles).length) {
                choice.roles = roles;
                if (body.orientation === 'quaternion') choice.orientation = body.orientation; else delete choice.orientation;
                delete choice.excluded;
            } else {
                // No role left: the node is no longer a body.
                delete choice.roles;
                choice.excluded = true;
                editingEntityId = null;
            }
            saveProjectData();
        });
        const cells = [element('span', { className: 'roleName', text: label }), select];
        if (!(role in body.roles) && kind !== 'quaternion') {
            const constant = element('input', { attributes: { type: 'number', step: 'any', 'aria-label': `Constant ${label} of ${body.entityName}` } });
            constant.value = String(body.constants[role] ?? 0);
            constant.addEventListener('change', () => {
                const value = Number(constant.value);
                const choice = choiceFor(body.entityId);
                choice.constants = { ...choice.constants, [role]: Number.isFinite(value) ? value : 0 };
                saveProjectData();
            });
            cells.push(constant, element('small', { className: 'roleUnit', text: kind === 'angle' ? (anyDegrees ? 'deg' : 'rad') : '' }));
        }
        editor.append(element('div', { className: role in body.roles || kind === 'quaternion' ? 'roleRow mapped' : 'roleRow' }, cells));
    }
    if (body.orientation === 'quaternion' && !hasQuaternion(body.roles)) {
        const chosen = quaternionRoles.filter((role) => role in body.roles).length;
        editor.append(element('p', { className: 'panelNote', text: `A quaternion needs all four states (${chosen} of 4 chosen); until then the body stays unturned.` }));
    }
    const unit = body.orientation === 'quaternion' ? null : element('select', { attributes: { 'aria-label': `Angle unit of ${body.entityName}` } }, [
        element('option', { text: 'Angles: each state\'s unit', attributes: { value: '' } }),
        element('option', { text: 'Angles in radians', attributes: { value: 'rad' } }),
        element('option', { text: 'Angles in degrees', attributes: { value: 'deg' } })
    ]);
    unit?.addEventListener('change', () => {
        const choice = choiceFor(body.entityId);
        if (unit.value) choice.angleUnit = unit.value; else delete choice.angleUnit;
        saveProjectData();
    });
    if (unit) unit.value = body.angleUnit ?? '';
    const actions = element('div', { className: 'editorActions' });
    const nodeSignalsMatch = matchConvention(nodeSignals, activeConventions(settings));
    if (body.source.kind === 'mapping' && nodeSignalsMatch) {
        // Back to the convention, which brings its own orientation.
        const reset = element('button', { text: `Use ${nodeSignalsMatch.convention.name} names`, attributes: { type: 'button' } });
        reset.addEventListener('click', () => {
            const choice = choiceFor(body.entityId);
            delete choice.roles;
            delete choice.orientation;
            saveProjectData();
        });
        actions.append(reset);
    }
    const remove = element('button', { text: 'Remove body', attributes: { type: 'button' } });
    remove.addEventListener('click', () => {
        projectData.bodies[body.entityId] = { excluded: true };
        editingEntityId = null;
        saveProjectData();
    });
    actions.append(remove);
    editor.append(...(unit ? [unit] : []), actions);
    return editor;
}

// Any other node in the result can be made a body: its roles start from whatever states a convention would name (the
// convention matching most of them, active or not, which also sets how it is turned), or its first state as x turned
// by the three angles, and the editor opens to set the rest.
function renderAddBody() {
    const select = $('#addBody');
    select.replaceChildren(element('option', { text: otherNodes.length ? 'Add a body…' : 'Every node is shown', attributes: { value: '' } }));
    for (const { entityId, entityName } of otherNodes) select.append(element('option', { text: entityName, attributes: { value: String(entityId) } }));
    select.disabled = !otherNodes.length;
}

$('#addBody').addEventListener('change', (event) => {
    const entityId = Number(event.target.value);
    if (!entityId) return;
    const nodeSignals = signals.filter((signal) => signal.entityId === entityId);
    const counts = orientations.map(({ orientation }) => ({ orientation, roles: startingRoles(nodeSignals, orientation) }));
    let { orientation, roles } = counts.reduce((best, next) => (Object.keys(next.roles).length > Object.keys(best.roles).length ? next : best));
    if (!Object.keys(roles).length && nodeSignals.length) roles = { x: nodeSignals[0].signalId };
    const choice = choiceFor(entityId);
    delete choice.excluded;
    choice.roles = roles;
    if (orientation === 'quaternion') choice.orientation = orientation; else delete choice.orientation;
    editingEntityId = entityId;
    saveProjectData();
});

// --- Naming conventions --------------------------------------------------------------------

function conventionSummary(convention) {
    const named = poseRoles.filter(({ role }) => role in convention.symbols)
        .map(({ role }) => (convention.symbols[role] === role ? role : `${role} = ${convention.symbols[role]}`)).join(', ');
    return normalizeOrientation(convention.orientation) === 'quaternion' ? `${named} · quaternion` : named;
}

function renderConventions() {
    const list = $('#conventions');
    list.replaceChildren();
    for (const convention of allConventions(settings)) {
        const row = element('div', { className: 'conventionRow' });
        const toggle = element('label', { className: 'viewToggle' });
        const input = element('input', { attributes: { type: 'checkbox' } });
        input.checked = settings.activeConventionIds.includes(convention.id);
        input.addEventListener('change', () => {
            settings.activeConventionIds = input.checked
                ? [...settings.activeConventionIds, convention.id]
                : settings.activeConventionIds.filter((id) => id !== convention.id);
            saveSettings();
        });
        toggle.append(input, element('span', {}, [element('b', { text: convention.name }), element('small', { text: conventionSummary(convention) })]));
        row.append(toggle);
        if (!convention.builtIn) {
            const edit = element('button', { className: 'iconButton', text: 'Edit', attributes: { type: 'button' } });
            edit.addEventListener('click', () => { conventionDraft = structuredClone(convention); renderConventions(); });
            const remove = element('button', { className: 'iconButton', text: 'Delete', attributes: { type: 'button', 'aria-label': `Delete ${convention.name}` } });
            remove.addEventListener('click', () => {
                settings.conventions = settings.conventions.filter(({ id }) => id !== convention.id);
                settings.activeConventionIds = settings.activeConventionIds.filter((id) => id !== convention.id);
                saveSettings();
            });
            row.append(edit, remove);
        }
        list.append(row);
    }
    $('#newConvention').hidden = Boolean(conventionDraft);
    $('#conventionForm').hidden = !conventionDraft;
    if (conventionDraft) fillConventionForm();
}

function fillConventionForm() {
    const form = $('#conventionForm');
    form.elements.name.value = conventionDraft.name ?? '';
    form.elements.orientation.value = normalizeOrientation(conventionDraft.orientation);
    for (const { role } of poseRoles) form.elements[role].value = conventionDraft.symbols?.[role] ?? '';
    showConventionOrientation();
    $('#conventionError').textContent = '';
}

// The form shows the angle fields or the quaternion fields, whichever the convention turns its bodies by; what was
// typed in the others stays until the form is saved, then only the chosen orientation's names are kept.
function showConventionOrientation() {
    const form = $('#conventionForm');
    const shown = new Set(rolesFor(form.elements.orientation.value).map(({ role }) => role));
    for (const { role } of poseRoles) form.elements[role].closest('.formRow').hidden = !shown.has(role);
}
$('#conventionForm').elements.orientation.addEventListener('change', showConventionOrientation);

$('#newConvention').addEventListener('click', () => {
    conventionDraft = { id: `convention-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, name: '', symbols: {} };
    renderConventions();
    $('#conventionForm').elements.name.focus();
});

$('#conventionForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.target;
    const convention = normalizeConvention({
        id: conventionDraft.id,
        name: form.elements.name.value,
        orientation: form.elements.orientation.value,
        symbols: Object.fromEntries(poseRoles.map(({ role }) => [role, form.elements[role].value]))
    });
    if (!convention) {
        $('#conventionError').textContent = 'Give it a name and the state symbol for at least one role, each symbol used once. A quaternion needs all four.';
        return;
    }
    const existing = settings.conventions.findIndex(({ id }) => id === convention.id);
    if (existing >= 0) settings.conventions[existing] = convention;
    else {
        settings.conventions.push(convention);
        settings.activeConventionIds.push(convention.id);
    }
    conventionDraft = null;
    saveSettings();
});

$('#cancelConvention').addEventListener('click', () => {
    conventionDraft = null;
    renderConventions();
});

// --- Keeping what the user set up ------------------------------------------------------------

function reportSaveFailure(error) {
    $('#configStatus').textContent = `Could not keep this change · ${error?.message ?? error}`;
}

// Each node's choices go with the project (saved when the user saves it); then the scene follows them.
function saveProjectData() {
    projectData = normalizeProjectData(projectData);
    $('#configStatus').textContent = '';
    bridge.setProjectData(Object.keys(projectData.bodies).length ? projectData : null).catch(reportSaveFailure);
    applyConfiguration();
}

// Conventions are the user's own, the same in every project.
function saveSettings() {
    settings = normalizeSettings(settings);
    $('#configStatus').textContent = '';
    bridge.setSettings(settings).catch(reportSaveFailure);
    renderConventions();
    applyConfiguration();
}

// --- Session lifecycle -----------------------------------------------------------------

function disposeBodies() {
    clearEdgeLines();
    bodies.forEach((body) => {
        if (!body.object3D) return;
        scene.remove(body.object3D);
        body.object3D.traverse((child) => {
            child.geometry?.dispose();
            child.material?.dispose();
        });
    });
    bodies = [];
}

// Finds the bodies from the signals, the conventions and the project's choices, reads their samples, and replaces
// the scene's bodies with them. A later call overtakes one still reading.
let configurationGeneration = 0;
async function applyConfiguration() {
    const generation = ++configurationGeneration;
    const resolved = resolveBodies(signals, { conventions: activeConventions(settings), projectData });
    const prepared = resolved.bodies.map((body, index) => ({ ...body, color: bodyPalette[index % bodyPalette.length], series: {}, object3D: null }));
    await Promise.all(prepared.map(loadSeriesFor));
    if (generation !== configurationGeneration) return;
    disposeBodies();
    bodies = prepared;
    otherNodes = resolved.others;
    if (!bodies.some((body) => body.entityId === editingEntityId)) editingEntityId = null;
    bodies.forEach((body) => {
        body.object3D = buildBodyObject(body);
        body.object3D.visible = !hiddenBodyIds.has(body.entityId);
    });
    renderBodyList();
    applyAllPoses(context?.time ?? 0);
    buildEdgeLines();
}

// The first scene this window shows starts square on to the plane its bodies move in, when they move in only one.
function suggestStartingView() {
    if (viewSuggested || !bodies.length) return;
    viewSuggested = true;
    const face = suggestedView(bodies);
    if (!face) return;
    const fit = fitOrbit(bodyBounds(), camera.fov, camera.aspect);
    animateOrbitTo({ ...orbitAnglesFor(faceDirections[face]), radius: fit?.radius ?? orbit.radius, target: fit?.target ?? orbit.target.clone() });
}

async function loadSession() {
    stopPlayback();
    context = await bridge.getContext();
    if (!context) return;
    signals = await bridge.listSignals();
    signalsById = new Map(signals.map((signal) => [signal.signalId, signal]));
    const [storedSettings, stored] = await Promise.all([
        bridge.getSettings().catch(() => null),
        bridge.getProjectData().catch(() => null)
    ]);
    settings = normalizeSettings(storedSettings);
    projectData = normalizeProjectData(stored?.data);
    hiddenBodyIds = new Set();
    editingEntityId = null;
    nodesById = new Map((context.nodes ?? []).map((node) => [node.id, node]));
    edgesForBodies = context.edges ?? [];
    renderConventions();
    await applyConfiguration();
    suggestStartingView();

    $('#projectName').textContent = context.projectName;
    $('#runName').textContent = context.run.name;
    $('#timeline').max = String(context.run.targetTime);
    $('#timeline').value = String(context.time);
    $('#currentTime').value = formatTime(context.time);
    $('#targetTime').value = formatTime(context.run.targetTime);
    renderRunStatus(context.run);
}

function renderRunStatus(run) {
    context.run = { ...context.run, ...run };
    $('#runLifecycle').textContent = context.run.lifecycle === 'running'
        ? `Live · ${formatTime(context.run.availableResultTime)}` : 'Completed';
    $('#playPause').disabled = context.run.lifecycle !== 'completed';
    if (context.run.lifecycle !== 'completed') stopPlayback();
}

// Mirrors the main project window's own result playback loop (same 100ms tick, same
// elapsed-wall-time * rate stepping) but drives it purely through seek() -- which already
// round-trips through the main window and back out to every open add-on's onTimelineChange,
// so this add-on doesn't need to track or apply poses locally while playing.
const preferredPlaybackFrameMilliseconds = 100;
let playing = false;
let playbackTimer = null;
let playbackStartedAt = 0;
let playbackStartedFrom = 0;
// Set on the final scheduled tick, once seek() has been sent for the run's end time but before
// its round trip back through onTimelineChange (see that handler below) has actually landed --
// stopping here instead of synchronously after seek() would flip #playPause to "done" while
// #timeline still shows the previous frame's value, a real (if narrow) visible race, not just a
// test-timing artifact: seek() is one-way IPC (ipcRenderer.send, addonPreload.cjs), so there is
// no completion signal to await directly.
let awaitingPlaybackEnd = false;

function stopPlayback() {
    clearTimeout(playbackTimer);
    playbackTimer = null;
    playing = false;
    awaitingPlaybackEnd = false;
    $('#playPause').textContent = '▶';
    $('#playPause').ariaLabel = 'Play';
}

function schedulePlayback() {
    if (!playing || !context) return;
    const rate = Number($('#playbackRate').value) || 1;
    const finalTime = context.run.availableResultTime;
    playbackTimer = setTimeout(() => {
        const elapsed = (performance.now() - playbackStartedAt) / 1000;
        const targetTime = Math.min(finalTime, playbackStartedFrom + elapsed * rate);
        if (targetTime >= finalTime) awaitingPlaybackEnd = true;
        else schedulePlayback();
        window.konjugateVisualizer.seek(targetTime);
    }, preferredPlaybackFrameMilliseconds);
}

$('#playPause').addEventListener('click', () => {
    if (!context || context.run.lifecycle !== 'completed') return;
    if (playing) { stopPlayback(); return; }
    playing = true;
    playbackStartedAt = performance.now();
    playbackStartedFrom = context.time >= context.run.availableResultTime ? 0 : context.time;
    $('#playPause').textContent = '❚❚';
    $('#playPause').ariaLabel = 'Pause';
    schedulePlayback();
});

$('#timeline').addEventListener('input', (event) => {
    stopPlayback();
    window.konjugateVisualizer.seek(Number(event.target.value));
});
window.konjugateVisualizer.onTimelineChange((time) => {
    if (!context) return;
    context.time = Number(time);
    $('#timeline').value = String(time);
    $('#currentTime').value = formatTime(time);
    applyAllPoses(context.time);
    if (awaitingPlaybackEnd) stopPlayback();
});
window.konjugateVisualizer.onSamplesAvailable(async ({ availableResultTime }) => {
    if (!context) return;
    context.run.availableResultTime = availableResultTime;
    renderRunStatus(context.run);
    await Promise.all(bodies.map(loadSeriesFor));
    applyAllPoses(context.time);
});
window.konjugateVisualizer.onRunStatusChange((run) => { if (context) renderRunStatus(run); });
window.konjugateVisualizer.onSelectionChange((nodeId) => {
    if (!context) return;
    context.selectedNodeId = nodeId;
    applySelection(nodeId);
});
window.konjugateVisualizer.onSessionChange(loadSession);

// Permanent test hook (mirrors window.__debugTransform in the main renderer) -- exposes the
// editor-authored rotation/scale actually applied to a body's shape sub-group, so interaction
// tests can verify it without reaching into three.js internals ad hoc.
window.__debugPoseVisualizer = {
    shapeTransform: (entityId) => {
        const body = bodies.find((candidate) => candidate.entityId === entityId);
        const shape = body?.object3D?.children[0];
        return shape ? { rotation: [shape.rotation.x, shape.rotation.y, shape.rotation.z], scale: [shape.scale.x, shape.scale.y, shape.scale.z] } : null;
    }
};

loadSession();

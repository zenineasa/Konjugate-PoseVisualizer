/* Copyright © 2026 Zenin Easa Panthakkalakath */

// Which signals make a body, and where that body is at a given time -- everything about a pose that doesn't need
// three.js or the page, so it can be tested on its own.
//
// A body has up to six roles: three positions and three angles. Any of them may be missing (a slider has only x, a
// hinge only an angle, a planar body x, y and yaw); a missing role holds a constant, 0 unless the user sets another.
// Which state plays which role comes either from a naming convention (a set of state symbols, one per role it uses)
// matched against each node's own states, or from a mapping the user made for that one node, kept with the project
// by signal id.

export const poseRoles = Object.freeze([
    { role: 'x', label: 'X', kind: 'position' },
    { role: 'y', label: 'Y', kind: 'position' },
    { role: 'z', label: 'Z', kind: 'position' },
    { role: 'roll', label: 'Roll', kind: 'angle', about: 'x' },
    { role: 'pitch', label: 'Pitch', kind: 'angle', about: 'y' },
    { role: 'yaw', label: 'Yaw', kind: 'angle', about: 'z' }
]);
const roleNames = poseRoles.map(({ role }) => role);
const isAngle = (role) => poseRoles.find((entry) => entry.role === role)?.kind === 'angle';

// Konjugate's own canonical vocabulary for pose (see the component library's Free body template), and the default
// convention: a node with states named exactly these six is a 6-DOF body without the user setting anything up.
export const defaultConvention = Object.freeze({
    id: 'konjugate',
    name: 'Konjugate',
    builtIn: true,
    symbols: Object.freeze({ x: 'x', y: 'y', z: 'z', roll: 'roll', pitch: 'pitch', yaw: 'yaw' })
});

const degreeUnits = new Set(['deg', 'degree', 'degrees', '°']);
export const isDegreeUnit = (unit) => degreeUnits.has(String(unit ?? '').trim().toLowerCase());

// --- Conventions, kept for the user ---------------------------------------------------------------------------

// A convention as the user wrote it, or null when it isn't one: a name, and a state symbol for at least one role,
// no symbol used for two roles.
export function normalizeConvention(candidate) {
    const name = String(candidate?.name ?? '').trim();
    if (!name || typeof candidate?.id !== 'string' || !candidate.id || candidate.id === defaultConvention.id) return null;
    const symbols = {};
    for (const role of roleNames) {
        const symbol = String(candidate.symbols?.[role] ?? '').trim();
        if (symbol) symbols[role] = symbol;
    }
    const used = Object.values(symbols);
    if (!used.length || new Set(used).size !== used.length) return null;
    return { id: candidate.id, name, symbols };
}

export function normalizeSettings(raw) {
    const conventions = [];
    for (const candidate of Array.isArray(raw?.conventions) ? raw.conventions : []) {
        const convention = normalizeConvention(candidate);
        if (convention && !conventions.some((existing) => existing.id === convention.id)) conventions.push(convention);
    }
    const known = new Set([defaultConvention.id, ...conventions.map(({ id }) => id)]);
    const active = Array.isArray(raw?.activeConventionIds)
        ? raw.activeConventionIds.filter((id) => known.has(id))
        : [defaultConvention.id];
    return { version: 1, conventions, activeConventionIds: [...new Set(active)] };
}

export const allConventions = (settings) => [defaultConvention, ...settings.conventions];
export const activeConventions = (settings) => allConventions(settings).filter(({ id }) => settings.activeConventionIds.includes(id));

// --- Per-node choices, kept with the project --------------------------------------------------------------------

// { bodies: { [entityId]: choice } }, where a choice may hold `roles` ({ role: signalId }, the user's own mapping),
// `constants` ({ role: number } for roles left unmapped), `angleUnit` ('rad' or 'deg'; otherwise each angle's own
// unit decides), `hidden`, and `excluded` (a node a convention matches that the user doesn't want as a body).
export function normalizeProjectData(raw) {
    const bodies = {};
    for (const [key, choice] of Object.entries(raw?.bodies ?? {})) {
        const entityId = Number(key);
        if (!Number.isSafeInteger(entityId) || entityId <= 0 || !choice || typeof choice !== 'object') continue;
        const kept = {};
        const roles = Object.fromEntries(Object.entries(choice.roles ?? {})
            .filter(([role, signalId]) => roleNames.includes(role) && Number.isSafeInteger(signalId) && signalId > 0));
        if (Object.keys(roles).length) kept.roles = roles;
        const constants = Object.fromEntries(Object.entries(choice.constants ?? {})
            .filter(([role, value]) => roleNames.includes(role) && Number.isFinite(value) && value !== 0));
        if (Object.keys(constants).length) kept.constants = constants;
        if (choice.angleUnit === 'rad' || choice.angleUnit === 'deg') kept.angleUnit = choice.angleUnit;
        if (choice.hidden === true) kept.hidden = true;
        if (choice.excluded === true && !kept.roles) kept.excluded = true;
        if (Object.keys(kept).length) bodies[entityId] = kept;
    }
    return { version: 1, bodies };
}

// --- Finding the bodies ---------------------------------------------------------------------------------------

// The roles a convention fills from one node's states, or null when the node lacks any of its symbols.
function rolesFromConvention(convention, bySymbol) {
    const roles = {};
    for (const [role, symbol] of Object.entries(convention.symbols)) {
        const signal = bySymbol.get(symbol);
        if (!signal) return null;
        roles[role] = signal.signalId;
    }
    return roles;
}

// The convention a node's states match, preferring the one that fills the most roles (so a node with all six is the
// 6-DOF body, not the planar one a shorter convention would also find in it).
export function matchConvention(nodeSignals, conventions) {
    const bySymbol = new Map(nodeSignals.map((signal) => [signal.symbol, signal]));
    let best = null;
    for (const convention of conventions) {
        const roles = rolesFromConvention(convention, bySymbol);
        if (roles && (!best || Object.keys(roles).length > Object.keys(best.roles).length)) best = { convention, roles };
    }
    return best;
}

// Every node that is a body, in catalogue order, with the signal for each role it has, and every node that isn't
// (which the user may make one). A user's mapping wins over a convention; a mapping whose signals have all gone
// from the result falls back to what the conventions find.
export function resolveBodies(signals, { conventions = [defaultConvention], projectData = { bodies: {} } } = {}) {
    const signalsById = new Map(signals.map((signal) => [signal.signalId, signal]));
    const byEntity = Map.groupBy(signals, (signal) => signal.entityId);
    const bodies = [];
    const others = [];
    byEntity.forEach((nodeSignals, entityId) => {
        const choice = projectData.bodies[entityId] ?? {};
        const entityName = nodeSignals[0].entityName;
        let roles = null;
        let source = null;
        if (choice.roles) {
            roles = Object.fromEntries(Object.entries(choice.roles).filter(([, signalId]) => signalsById.has(signalId)));
            if (Object.keys(roles).length) source = { kind: 'mapping' };
            else roles = null;
        }
        if (!roles && !choice.excluded) {
            const match = matchConvention(nodeSignals, conventions);
            if (match) {
                roles = match.roles;
                source = { kind: 'convention', conventionId: match.convention.id, conventionName: match.convention.name };
            }
        }
        if (!roles) {
            others.push({ entityId, entityName });
            return;
        }
        const angleUnits = {};
        for (const [role, signalId] of Object.entries(roles)) {
            if (isAngle(role)) angleUnits[role] = choice.angleUnit ?? (isDegreeUnit(signalsById.get(signalId).unit) ? 'deg' : 'rad');
        }
        const constants = Object.fromEntries(Object.entries(choice.constants ?? {}).filter(([role]) => !(role in roles)));
        bodies.push({ entityId, entityName, roles, constants, angleUnit: choice.angleUnit ?? null, angleUnits, hidden: Boolean(choice.hidden), source });
    });
    return { bodies, others };
}

// --- Where a body is ------------------------------------------------------------------------------------------

// Binary search for the sample nearest the requested time -- an exact interpolation isn't needed here, since the
// timeline only ever asks for a specific sampled instant, the same way the plot viewer's own cursor line just marks
// a time position rather than resampling.
export function nearestValue(samples, time) {
    if (!samples?.length) return 0;
    let low = 0;
    let high = samples.length - 1;
    while (low < high) {
        const mid = (low + high) >> 1;
        if (samples[mid].time < time) low = mid + 1; else high = mid;
    }
    if (low > 0 && Math.abs(samples[low - 1].time - time) <= Math.abs(samples[low].time - time)) low -= 1;
    return samples[low].value;
}

const toRadians = (value, unit) => (unit === 'deg' ? value * Math.PI / 180 : value);

// The body's full pose at a time, angles in radians: mapped roles from their samples (seriesByRole), the rest from
// the body's constants. An unmapped angle's constant is in the body's chosen angle unit, radians unless it chose degrees.
export function poseAt(body, seriesByRole, time) {
    return Object.fromEntries(roleNames.map((role) => {
        if (role in body.roles) {
            const value = nearestValue(seriesByRole[role], time);
            return [role, isAngle(role) ? toRadians(value, body.angleUnits[role]) : value];
        }
        const constant = body.constants[role] ?? 0;
        return [role, isAngle(role) ? toRadians(constant, body.angleUnit ?? 'rad') : constant];
    }));
}

// Body-to-world rotation matrix in MODEL space, for the same ZYX (yaw-pitch-roll intrinsic) Euler convention already
// derived and used for this app's own kinematics content: R = Rz(yaw)*Ry(pitch)*Rx(roll). Returns the body's own
// X/Y/Z axes as unit vectors expressed in model world space (the columns of R), which the viewer then remaps
// individually into three.js space -- this avoids re-deriving an Euler-order conjugation by hand, and is why it's
// built as three separate basis vectors rather than a single combined transform.
export function modelBodyAxes(roll, pitch, yaw) {
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    return {
        bx: [cy * cp, sy * cp, -sp],
        by: [cy * sp * sr - sy * cr, sy * sp * sr + cy * cr, cp * sr],
        bz: [cy * sp * cr + sy * sr, sy * sp * cr - cy * sr, cp * cr]
    };
}

// --- Presenting a body ----------------------------------------------------------------------------------------

// A short line naming what drives the body: each mapped role, with the state's symbol where it differs, and the
// angle unit when any angle is in degrees -- "x, y, yaw = theta · deg".
export function describeBody(body, signalsById) {
    const parts = poseRoles.filter(({ role }) => role in body.roles).map(({ role }) => {
        const symbol = signalsById.get(body.roles[role])?.symbol;
        return symbol && symbol !== role ? `${role} = ${symbol}` : role;
    });
    const degrees = Object.values(body.angleUnits).includes('deg');
    return `${parts.join(', ')}${degrees ? ' · deg' : ''}`;
}

// The view cube face to start from when every body moves in one plane only (a 1- or 2-DOF scene reads better square
// on than from the 3D corner), or null when something moves out of it. Model x/y is the ground and z is up:
// front looks along model y (seeing x and z), right along model x (seeing y and z), top down z (seeing x and y). A
// turn about an axis moves the body in the plane across it.
export function suggestedView(bodies) {
    if (!bodies.length) return null;
    const moving = new Set();
    for (const body of bodies) {
        for (const role of Object.keys(body.roles)) {
            const entry = poseRoles.find((candidate) => candidate.role === role);
            if (entry.kind === 'position') moving.add(role);
            else for (const axis of ['x', 'y', 'z']) if (axis !== entry.about) moving.add(axis);
        }
    }
    const within = (axes) => [...moving].every((axis) => axes.includes(axis));
    if (within(['x', 'z'])) return 'front';
    if (within(['y', 'z'])) return 'right';
    if (within(['x', 'y'])) return 'top';
    return null;
}

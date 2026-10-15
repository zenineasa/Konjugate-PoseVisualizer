# Working in this repository

Konjugate Pose Visualizer: an add-on rendering 6-DOF bodies from a result in Three.js (`package/`).

Konjugate's checkout is expected at `../konjugate` (or `KONJUGATE_DIR`); see its `docs/addonDevelopment.md` for the add-on API.

Commands: `npm run build`, `npm test`, `npm run install:dev` (build and install into your local Konjugate).

Conventions:

- The owner commits and pushes tags; propose a one-sentence commit message describing the change in behaviour, in the style of `git log`.
- GitHub builds only for a version: a `v*` tag runs `release.yml` (build, sign, publish); `build.yml` runs only when started by hand. Run `npm test` before tagging.
- If the add-on comes to need a new Konjugate feature (its manifest's `requires`), release it after the Konjugate release that has it.
- Every fix comes with a test that would have caught it. Keep `ReadMe.md` current.

# Konjugate Pose Visualizer

A [Konjugate](https://github.com/zenineasa/Konjugate) add-on that renders the nodes of a result as bodies in a Three.js scene, each moved by its own states, with timeline scrubbing and playback synced to the simulation. A body may have all six degrees of freedom or as few as one: a slider with only `x`, a hinge with only an angle, a planar body with `x`, `y` and `yaw`.

## Which nodes are bodies

By default a node whose states are named `x`, `y`, `z`, `roll`, `pitch` and `yaw` is a 6-DOF body, with nothing to set up. Positions are in model space (x and y the ground, z up); angles turn the body yaw about z, then pitch about y, then roll about x.

- **Naming conventions.** Under *Naming conventions* in the sidebar, add your own: a name and the state symbol for each role it uses (`px`, `py` and `theta` for yaw, say). Leave a role blank and the convention doesn't use it. A node whose states have every symbol a ticked convention lists is a body; when several match, the one using the most roles wins. Untick a convention, Konjugate's own included, to stop it finding bodies. Conventions are kept for you, the same in every project.
- **One node at a time.** *Edit* on a body chooses which of its states plays each role, or holds a role at a constant. *Add a body* makes any other node in the result a body, and *Remove body* leaves one out. These choices are kept with the project, by node and state id, and saved when you save the project.
- **Angles** are read as radians, or as degrees when a state's unit is `deg`, `degree`, `degrees` or `°`. A body can be set to radians or degrees regardless.

A role left out stays still at its constant, 0 unless you set another. When every body moves in a single plane, the view starts square on to that plane.

This version needs a Konjugate that lets result visualizers keep data with the project and settings for the user (the manifest's `requires`: `projectData`, `addonSettings`); an older Konjugate refuses to install it.

## Moving around the scene

The view cube in the corner is the one in Konjugate's own editor, and works the same way. Drag to orbit and scroll to zoom as before; click a face (Front, Back, Left, Right, Top, Bottom) or a corner of the cube to look from there, use the ring around it to pan, **−** and **＋** to zoom, and **Fit** to frame the bodies currently shown. The cube turns with the camera and lights the face you are looking straight at. It appears once a result has bodies to show.

## Installing

Open Konjugate's Extensions dialog, switch to Discover, and install "Pose Visualizer" from there.

## Building from source

This repo builds against a sibling checkout of Konjugate core -- clone both side by side:

```
git clone https://github.com/zenineasa/Konjugate
git clone https://github.com/zenineasa/Konjugate-PoseVisualizer
cd Konjugate-PoseVisualizer
npm run build        # writes out/konjugate.poseVisualizer-<version>.kja
npm run install:dev  # also installs it into your local Konjugate's userData
```

`KONJUGATE_DIR` overrides the sibling-checkout assumption if you keep it elsewhere.

## Third-party software

Vendors [three.js](https://threejs.org/) (MIT) -- see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## License

[MPL-2.0](LICENSE), matching Konjugate core.

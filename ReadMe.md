# Konjugate Pose Visualizer

A [Konjugate](https://github.com/zenineasa/Konjugate) add-on that renders a Three.js scene of every node in a result that carries all six of `x`, `y`, `z`, `roll`, `pitch` and `yaw` as its own states -- a 6-DOF body -- with timeline scrubbing and playback synced to the simulation.

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

# Eigen Explorer

A small no-build web app for visualizing eigenvalues and eigenvectors in the spirit of 3Blue1Brown's geometric treatment: deform the plane first, then use the algebra to explain what the eye already noticed.

## Run it

From `~/eigen-visual`:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## What it includes

- An animated interpolation from the identity matrix to a target `2 x 2` matrix.
- Two labeled animation views for pure rotations: `Matrix morph` and `Geometric action`.
- A draggable probe vector with live span drift, along-probe scale, off-span slip, and image readout.
- Draggable basis-image arrows so the matrix columns can be reshaped directly on the stage.
- Real-time trace, determinant, discriminant, and characteristic polynomial updates.
- Presets for the key classroom cases: two real eigenlines, sign-flipping eigenvalues, a defective shear, uniform scaling, and pure rotation.

## Files

- `index.html`: app structure and learning copy.
- `styles.css`: layout, visual system, and responsive behavior.
- `app.js`: rendering, interaction, and eigen computations.

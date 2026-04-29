const WORLD_RANGE = 5.6;
const GRID_LIMIT = 5;
const EPSILON = 1e-8;
const DRAG_HANDLE_RADIUS = 26;
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const presets = [
  {
    id: "two-real",
    label: "Two real directions",
    matrix: { a: 3, b: 1, c: 0, d: 2 },
    vector: { x: 2.2, y: 1.4 },
    prompt:
      "Most directions drift away from their span. Try dragging until the orange image lands back on the gold guide.",
  },
  {
    id: "flip",
    label: "Flip through origin",
    matrix: { a: 1, b: 2, c: 0, d: -1 },
    vector: { x: 1.8, y: -1.2 },
    prompt:
      "One invariant direction keeps orientation, another reverses through the origin. Watch the sign of the scale factor.",
  },
  {
    id: "shear",
    label: "Single eigenline",
    matrix: { a: 1, b: 1, c: 0, d: 1 },
    vector: { x: 2.1, y: 1.1 },
    prompt:
      "A shear has only one visible eigenline. Nearby directions slide away from it instead of simply stretching.",
  },
  {
    id: "uniform",
    label: "Uniform scaling",
    matrix: { a: 1.8, b: 0, c: 0, d: 1.8 },
    vector: { x: 2.5, y: 0.9 },
    prompt:
      "Every direction stays on its own span here. This is the limiting case where every non-zero vector is an eigenvector.",
  },
  {
    id: "rotation",
    label: "Pure rotation",
    matrix: { a: 0, b: -1, c: 1, d: 0 },
    vector: { x: 2.4, y: 0.8 },
    prompt:
      "No real direction survives unchanged. The probe always leaves its span, so the eigenvalues move off the real line.",
  },
];

const presetMap = new Map(presets.map((preset) => [preset.id, preset]));

const state = {
  matrix: { ...presets[0].matrix },
  vector: { ...presets[0].vector },
  progress: 1,
  activePreset: presets[0].id,
  motionMode: "matrix-morph",
  scheme: "earthy",
  showClockLabels: false,
  isPlaying: false,
  dragPointerId: null,
  dragTarget: null,
  rafId: 0,
  lastFrameTime: 0,
  size: { width: 0, height: 0 },
};

const canvas = document.getElementById("stageCanvas");
const ctx = canvas.getContext("2d");

const elements = {
  presetRow: document.getElementById("presetRow"),
  modeButtons: Array.from(document.querySelectorAll(".mode-chip")),
  modeHint: document.getElementById("modeHint"),
  playButton: document.getElementById("playButton"),
  progressSlider: document.getElementById("progressSlider"),
  progressValue: document.getElementById("progressValue"),
  schemeSelect: document.getElementById("schemeSelect"),
  identityButton: document.getElementById("identityButton"),
  showClockLabels: document.getElementById("showClockLabels"),
  inputs: {
    a: document.getElementById("input-a"),
    b: document.getElementById("input-b"),
    c: document.getElementById("input-c"),
    d: document.getElementById("input-d"),
    x: document.getElementById("vector-x"),
    y: document.getElementById("vector-y"),
  },
  traceValue: document.getElementById("traceValue"),
  detValue: document.getElementById("detValue"),
  discValue: document.getElementById("discValue"),
  lineCountValue: document.getElementById("lineCountValue"),
  driftValue: document.getElementById("driftValue"),
  alongValue: document.getElementById("alongValue"),
  slipValue: document.getElementById("slipValue"),
  imageValue: document.getElementById("imageValue"),
  polyValue: document.getElementById("polyValue"),
  eigenSummary: document.getElementById("eigenSummary"),
  eigenDetails: document.getElementById("eigenDetails"),
  presetPrompt: document.getElementById("presetPrompt"),
  noticeText: document.getElementById("noticeText"),
  canvasNote: document.getElementById("canvasNote"),
};

function init() {
  const savedScheme = localStorage.getItem("eigen-scheme");
  const defaultScheme = elements.schemeSelect.querySelector("option[selected]")?.value;
  state.scheme = savedScheme || defaultScheme || state.scheme;
  applyScheme(state.scheme);
  renderPresetButtons();
  syncInputsFromState();
  wireEvents();
  resizeCanvas();
  updateAll();
  if (!prefersReducedMotion.matches) {
    replayTransform();
  }
}

function renderPresetButtons() {
  presets.forEach((preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "preset-chip";
    button.textContent = preset.label;
    button.dataset.presetId = preset.id;
    button.addEventListener("click", () => applyPreset(preset.id));
    elements.presetRow.appendChild(button);
  });
  updatePresetButtons();
}

function wireEvents() {
  Object.entries({
    a: "a",
    b: "b",
    c: "c",
    d: "d",
  }).forEach(([id, key]) => {
    bindNumericInput(elements.inputs[id], (value) => {
      state.matrix[key] = value;
      state.progress = 1;
      state.activePreset = null;
      stopAnimation();
      updateAll();
    });
  });

  Object.entries({
    x: "x",
    y: "y",
  }).forEach(([id, key]) => {
    bindNumericInput(elements.inputs[id], (value) => {
      state.vector[key] = value;
      ensureNonZeroVector();
      stopAnimation();
      updateAll();
    });
  });

  elements.progressSlider.addEventListener("input", (event) => {
    state.progress = Number(event.target.value) / 100;
    stopAnimation();
    updateAll();
  });

  elements.schemeSelect.addEventListener("change", (event) => {
    state.scheme = event.target.value;
    localStorage.setItem("eigen-scheme", state.scheme);
    applyScheme(state.scheme);
    updateAll();
  });

  elements.modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextMode = button.dataset.mode;
      if (!nextMode) {
        return;
      }

      if (nextMode === "geometric-action" && !supportsGeometricAction(state.matrix)) {
        return;
      }

      state.motionMode = nextMode;
      stopAnimation();
      updateAll();
    });
  });

  elements.showClockLabels.addEventListener("change", (event) => {
    state.showClockLabels = event.target.checked;
    updateAll();
  });

  elements.playButton.addEventListener("click", replayTransform);

  elements.identityButton.addEventListener("click", () => {
    state.matrix = { a: 1, b: 0, c: 0, d: 1 };
    state.activePreset = null;
    state.progress = 1;
    stopAnimation();
    updateAll();
  });

  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", handlePointerUp);
  canvas.addEventListener("pointercancel", handlePointerUp);
  canvas.addEventListener("pointerleave", handlePointerLeave);

  const resizeObserver = new ResizeObserver(() => resizeCanvas());
  resizeObserver.observe(canvas.parentElement);
  const handleMotionChange = () => {
    if (prefersReducedMotion.matches) {
      stopAnimation();
      state.progress = 1;
      updateAll();
    }
  };
  if (typeof prefersReducedMotion.addEventListener === "function") {
    prefersReducedMotion.addEventListener("change", handleMotionChange);
  } else if (typeof prefersReducedMotion.addListener === "function") {
    prefersReducedMotion.addListener(handleMotionChange);
  }
}

function applyPreset(presetId) {
  const preset = presetMap.get(presetId);
  if (!preset) {
    return;
  }

  state.matrix = { ...preset.matrix };
  state.vector = { ...preset.vector };
  state.activePreset = preset.id;
  ensureNonZeroVector();
  canonicalizeMotionMode();
  syncInputsFromState();
  updateAll();
  if (!prefersReducedMotion.matches) {
    replayTransform();
  }
}

function replayTransform() {
  stopAnimation();
  state.progress = 0;
  state.isPlaying = true;
  state.lastFrameTime = 0;
  updateAll();
  state.rafId = requestAnimationFrame(stepAnimation);
}

function stepAnimation(timestamp) {
  if (!state.isPlaying) {
    return;
  }

  if (state.lastFrameTime === 0) {
    state.lastFrameTime = timestamp;
  }

  const delta = timestamp - state.lastFrameTime;
  state.lastFrameTime = timestamp;
  state.progress = Math.min(1, state.progress + delta / 1600);
  updateAll();

  if (state.progress < 1) {
    state.rafId = requestAnimationFrame(stepAnimation);
  } else {
    state.isPlaying = false;
  }
}

function stopAnimation() {
  state.isPlaying = false;
  state.lastFrameTime = 0;
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }
}

function handlePointerDown(event) {
  const closestHandle = getClosestHandle(event);
  if (!closestHandle) {
    return;
  }

  state.dragPointerId = event.pointerId;
  state.dragTarget = closestHandle.target;
  canvas.setPointerCapture(event.pointerId);
  setCanvasCursor("grabbing");
  updateFromPointer(event);
}

function handlePointerMove(event) {
  if (state.dragPointerId === event.pointerId) {
    setCanvasCursor("grabbing");
    updateFromPointer(event);
    return;
  }

  refreshCanvasCursor(event);
}

function handlePointerUp(event) {
  if (state.dragPointerId !== event.pointerId) {
    return;
  }

  state.dragPointerId = null;
  state.dragTarget = null;
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  refreshCanvasCursor(event);
}

function handlePointerLeave() {
  if (state.dragPointerId === null) {
    setCanvasCursor("crosshair");
  }
}

function updateFromPointer(event) {
  if (state.dragTarget === "vector") {
    updateVectorFromPointer(event);
    return;
  }

  if (state.dragTarget === "basis-e1") {
    updateBasisVectorFromPointer(event, "e1");
    return;
  }

  if (state.dragTarget === "basis-e2") {
    updateBasisVectorFromPointer(event, "e2");
  }
}

function updateVectorFromPointer(event) {
  const rect = canvas.getBoundingClientRect();
  const next = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
  state.vector.x = clamp(next.x, -WORLD_RANGE + 0.3, WORLD_RANGE - 0.3);
  state.vector.y = clamp(next.y, -WORLD_RANGE + 0.3, WORLD_RANGE - 0.3);
  ensureNonZeroVector();
  stopAnimation();
  syncVectorInputs();
  updateAll();
}

function updateBasisVectorFromPointer(event, basisKey) {
  const rect = canvas.getBoundingClientRect();
  const next = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
  const clamped = {
    x: clamp(next.x, -WORLD_RANGE + 0.3, WORLD_RANGE - 0.3),
    y: clamp(next.y, -WORLD_RANGE + 0.3, WORLD_RANGE - 0.3),
  };

  if (basisKey === "e1") {
    state.matrix.a = clamped.x;
    state.matrix.c = clamped.y;
  } else {
    state.matrix.b = clamped.x;
    state.matrix.d = clamped.y;
  }

  state.progress = 1;
  state.activePreset = null;
  stopAnimation();
  syncInputsFromState();
  updateAll();
}

function getClosestHandle(event) {
  const rect = canvas.getBoundingClientRect();
  const currentMatrix = getAnimatedMatrix();
  const handles = [
    { target: "vector", point: state.vector },
    { target: "basis-e1", point: { x: currentMatrix.a, y: currentMatrix.c } },
    { target: "basis-e2", point: { x: currentMatrix.b, y: currentMatrix.d } },
  ];

  let closestHandle = null;
  handles.forEach((handle) => {
    const tip = worldToScreen(handle.point);
    const distance = Math.hypot(event.clientX - rect.left - tip.x, event.clientY - rect.top - tip.y);
    if (!closestHandle || distance < closestHandle.distance) {
      closestHandle = { ...handle, distance };
    }
  });

  if (!closestHandle || closestHandle.distance > DRAG_HANDLE_RADIUS) {
    return null;
  }

  return closestHandle;
}

function refreshCanvasCursor(event) {
  const hoveredHandle = getClosestHandle(event);
  setCanvasCursor(hoveredHandle ? "grab" : "crosshair");
}

function setCanvasCursor(cursor) {
  canvas.style.cursor = cursor;
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  state.size.width = rect.width;
  state.size.height = rect.height;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  renderScene();
}

function updateAll() {
  canonicalizeMotionMode();
  syncInputsFromState();
  updatePresetButtons();
  updateModeButtons();
  updateText();
  renderScene();
}

function syncInputsFromState() {
  elements.inputs.a.value = formatInput(state.matrix.a);
  elements.inputs.b.value = formatInput(state.matrix.b);
  elements.inputs.c.value = formatInput(state.matrix.c);
  elements.inputs.d.value = formatInput(state.matrix.d);
  syncVectorInputs();
  elements.progressSlider.value = String(Math.round(state.progress * 100));
  elements.progressValue.textContent = `${Math.round(state.progress * 100)}%`;
  elements.schemeSelect.value = state.scheme;
  elements.showClockLabels.checked = state.showClockLabels;
}

function applyScheme(scheme) {
  document.body.dataset.scheme = scheme;
  document.documentElement.style.colorScheme =
    scheme === "dark" || scheme === "halloween" ? "dark" : "light";
}

function getCanvasTheme() {
  const styles = getComputedStyle(document.body);
  const color = (name) => styles.getPropertyValue(name).trim();

  return {
    canvasBackdropStart: color("--canvas-backdrop-start"),
    canvasBackdropEnd: color("--canvas-backdrop-end"),
    referenceCircleFill: color("--reference-circle-fill"),
    referenceCircleStroke: color("--reference-circle-stroke"),
    referenceGridLine: color("--reference-grid-line"),
    referenceGridAxis: color("--reference-grid-axis"),
    transformCircleFill: color("--transform-circle-fill"),
    transformCircleStroke: color("--transform-circle-stroke"),
    transformGridLine: color("--transform-grid-line"),
    transformGridAxis: color("--transform-grid-axis"),
    clockReferenceFill: color("--clock-reference-fill"),
    clockReferenceHalo: color("--clock-reference-halo"),
    clockTransformFill: color("--clock-transform-fill"),
    clockTransformHalo: color("--clock-transform-halo"),
    basisE1: color("--basis-e1"),
    basisE1Handle: color("--basis-e1-handle"),
    basisE2: color("--basis-e2"),
    basisE2Handle: color("--basis-e2-handle"),
    probeLine: color("--probe-line"),
    probeArrow: color("--probe-arrow"),
    probeHandle: color("--probe-handle"),
    imageArrow: color("--image-arrow"),
    eigenLine: color("--eigen-line"),
    eigenLineSoft: color("--eigen-line-soft"),
    eigenTagBg: color("--eigen-tag-bg"),
    projectionLine: color("--projection-line"),
    tagBg: color("--tag-bg"),
    tagInk: color("--tag-ink"),
    handleStroke: color("--handle-stroke"),
    originFill: color("--origin-fill"),
  };
}

function syncVectorInputs() {
  elements.inputs.x.value = formatInput(state.vector.x);
  elements.inputs.y.value = formatInput(state.vector.y);
}

function updatePresetButtons() {
  const buttons = elements.presetRow.querySelectorAll(".preset-chip");
  buttons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.presetId === state.activePreset);
  });
}

function updateModeButtons() {
  const geometricAvailable = supportsGeometricAction(state.matrix);
  elements.modeButtons.forEach((button) => {
    const isActive = button.dataset.mode === state.motionMode;
    const isDisabled = button.dataset.mode === "geometric-action" && !geometricAvailable;
    button.classList.toggle("is-active", isActive);
    button.disabled = isDisabled;
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function updateText() {
  const eigenData = computeEigenData(state.matrix);
  const currentMatrix = getAnimatedMatrix();
  const image = applyMatrix(currentMatrix, state.vector);
  const drift = computeSpanDrift(state.vector, image);
  const alongScale = dot(state.vector, image) / Math.max(dot(state.vector, state.vector), EPSILON);
  const slip = Math.abs(cross(state.vector, image)) / Math.max(length(state.vector), EPSILON);

  elements.traceValue.textContent = formatNumber(eigenData.trace);
  elements.detValue.textContent = formatNumber(eigenData.det);
  elements.discValue.textContent = formatNumber(eigenData.discriminant);
  elements.lineCountValue.textContent = eigenData.realLineLabel;

  elements.driftValue.textContent = `${formatNumber(drift)} deg`;
  elements.alongValue.textContent = formatNumber(alongScale);
  elements.slipValue.textContent = formatNumber(slip);
  elements.imageValue.textContent = `(${formatNumber(image.x)}, ${formatNumber(image.y)})`;

  elements.polyValue.textContent = formatCharacteristicPolynomial(eigenData.trace, eigenData.det);

  const presetPrompt = state.activePreset
    ? presetMap.get(state.activePreset)?.prompt
    : "Custom matrix loaded. Edit entries, scrub the transform, and look for directions that keep landing on their own span.";
  elements.presetPrompt.textContent = presetPrompt;

  elements.eigenSummary.innerHTML = buildEigenSummary(eigenData);
  elements.eigenDetails.innerHTML = buildEigenDetails(eigenData);

  elements.modeHint.textContent = buildModeHint();
  elements.noticeText.textContent = buildNoticeText(eigenData, drift, alongScale, slip);
  elements.canvasNote.textContent = buildCanvasNote(eigenData, drift);
}

function renderScene() {
  if (!state.size.width || !state.size.height) {
    return;
  }

  const { width, height } = state.size;
  const currentMatrix = getAnimatedMatrix();
  const finalEigenData = computeEigenData(state.matrix);
  const theme = getCanvasTheme();
  const image = applyMatrix(currentMatrix, state.vector);
  const projectionScale = dot(state.vector, image) / Math.max(dot(state.vector, state.vector), EPSILON);
  const projectedImage = scale(state.vector, projectionScale);

  ctx.clearRect(0, 0, width, height);
  drawStageBackdrop(width, height, theme);
  drawUnitCircle({ a: 1, b: 0, c: 0, d: 1 }, {
    fill: theme.referenceCircleFill,
    stroke: theme.referenceCircleStroke,
    dash: [5, 8],
    width: 1.2,
  });
  drawGrid({ a: 1, b: 0, c: 0, d: 1 }, {
    lineColor: theme.referenceGridLine,
    axisColor: theme.referenceGridAxis,
    lineWidth: 1,
    axisWidth: 1.9,
  });
  drawUnitCircle(currentMatrix, {
    fill: theme.transformCircleFill,
    stroke: theme.transformCircleStroke,
    dash: [],
    width: 1.7,
  });
  drawGrid(currentMatrix, {
    lineColor: theme.transformGridLine,
    axisColor: theme.transformGridAxis,
    lineWidth: 1.3,
    axisWidth: 2.5,
  });

  if (state.showClockLabels) {
    drawClockNumbers({ a: 1, b: 0, c: 0, d: 1 }, {
      fill: theme.clockReferenceFill,
      halo: theme.clockReferenceHalo,
      transformGlyphs: false,
    });
    drawClockNumbers(currentMatrix, {
      fill: theme.clockTransformFill,
      halo: theme.clockTransformHalo,
      transformGlyphs: true,
    });
  }

  drawEigenlines(finalEigenData, theme);
  drawProbeGuide(state.vector, theme);
  drawBasisVectors(currentMatrix, theme);
  drawProjection(projectedImage, image, theme);
  drawArrow(state.vector, {
    color: theme.probeArrow,
    width: 2.4,
    label: "v",
    headSize: 11,
    tagFill: theme.tagBg,
    tagInk: theme.tagInk,
  });
  drawArrow(image, {
    color: theme.imageArrow,
    width: 3.2,
    label: "T(v)",
    headSize: 12,
    tagFill: theme.tagBg,
    tagInk: theme.tagInk,
  });
  drawHandle(state.vector, {
    fill: theme.probeHandle,
    stroke: theme.handleStroke,
  });
  drawOrigin(theme);
}

function drawStageBackdrop(width, height, theme) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, theme.canvasBackdropStart);
  gradient.addColorStop(1, theme.canvasBackdropEnd);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function drawGrid(matrix, style) {
  for (let k = -GRID_LIMIT; k <= GRID_LIMIT; k += 1) {
    const lineStyle = k === 0
      ? { stroke: style.axisColor, width: style.axisWidth }
      : { stroke: style.lineColor, width: style.lineWidth };
    const verticalA = applyMatrix(matrix, { x: k, y: -WORLD_RANGE });
    const verticalB = applyMatrix(matrix, { x: k, y: WORLD_RANGE });
    const horizontalA = applyMatrix(matrix, { x: -WORLD_RANGE, y: k });
    const horizontalB = applyMatrix(matrix, { x: WORLD_RANGE, y: k });
    drawWorldLine(verticalA, verticalB, lineStyle);
    drawWorldLine(horizontalA, horizontalB, lineStyle);
  }
}

function drawUnitCircle(matrix, style) {
  ctx.save();
  ctx.beginPath();
  for (let index = 0; index <= 128; index += 1) {
    const angle = (index / 128) * Math.PI * 2;
    const point = applyMatrix(matrix, { x: Math.cos(angle), y: Math.sin(angle) });
    const screen = worldToScreen(point);
    if (index === 0) {
      ctx.moveTo(screen.x, screen.y);
    } else {
      ctx.lineTo(screen.x, screen.y);
    }
  }
  ctx.fillStyle = style.fill;
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = style.width;
  ctx.setLineDash(style.dash);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawClockNumbers(matrix, style) {
  const scalePixels = getWorldScalePixels();
  const fontSizePixels = 12;
  const haloWidthPixels = 3.4;
  const circlePaddingPixels = 3;
  const fontFamily = '"Avenir Next", "Segoe UI", sans-serif';

  ctx.save();
  ctx.font = `600 ${fontSizePixels}px ${fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  if (style.transformGlyphs) {
    const fontSizeWorld = fontSizePixels / scalePixels;
    const haloWidthWorld = haloWidthPixels / scalePixels;
    const center = worldToScreen({ x: 0, y: 0 });

    for (let hour = 1; hour <= 12; hour += 1) {
      const layout = getClockLabelLayout(hour, {
        scalePixels,
        paddingPixels: circlePaddingPixels + haloWidthPixels * 0.5,
      });
      const anchor = applyMatrix(matrix, layout.center);

      ctx.save();
      ctx.translate(center.x, center.y);
      ctx.scale(scalePixels, -scalePixels);
      ctx.transform(matrix.a, matrix.c, matrix.b, matrix.d, anchor.x, anchor.y);
      // Canvas text uses y-down glyph coordinates; flip once here so the
      // world-to-screen y inversion does not introduce an extra mirror.
      ctx.scale(1, -1);
      ctx.font = `600 ${fontSizeWorld}px ${fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.lineWidth = haloWidthWorld;
      ctx.strokeStyle = style.halo;
      ctx.fillStyle = style.fill;
      ctx.strokeText(
        layout.label,
        layout.textOffsetWorld.x,
        layout.textOffsetWorld.y
      );
      ctx.fillText(
        layout.label,
        layout.textOffsetWorld.x,
        layout.textOffsetWorld.y
      );
      ctx.restore();
    }

    ctx.restore();
    return;
  }

  ctx.lineWidth = haloWidthPixels;
  ctx.strokeStyle = style.halo;
  ctx.fillStyle = style.fill;

  for (let hour = 1; hour <= 12; hour += 1) {
    const layout = getClockLabelLayout(hour, {
      scalePixels,
      paddingPixels: circlePaddingPixels + haloWidthPixels * 0.5,
    });
    const screen = worldToScreen(applyMatrix(matrix, layout.center));
    ctx.strokeText(
      layout.label,
      screen.x + layout.textOffsetPixels.x,
      screen.y + layout.textOffsetPixels.y
    );
    ctx.fillText(
      layout.label,
      screen.x + layout.textOffsetPixels.x,
      screen.y + layout.textOffsetPixels.y
    );
  }

  ctx.restore();
}

function getClockLabelLayout(hour, options) {
  const angle = Math.PI / 2 - ((hour % 12) * Math.PI) / 6;
  const label = String(hour);
  const metrics = ctx.measureText(label);
  const bounds = getTextPlacementBounds(metrics, options.scalePixels);
  const unit = { x: Math.cos(angle), y: Math.sin(angle) };
  const radialExtent = Math.abs(unit.x) * bounds.halfWidth + Math.abs(unit.y) * bounds.halfHeight;
  const paddingWorld = options.paddingPixels / options.scalePixels;
  const radius = Math.max(0, 1 - paddingWorld - radialExtent);

  return {
    label,
    center: {
      x: radius * unit.x,
      y: radius * unit.y,
    },
    textOffsetPixels: bounds.alignOffsetPixels,
    textOffsetWorld: bounds.alignOffsetWorld,
  };
}

function getTextPlacementBounds(metrics, scalePixels) {
  const fallbackHalfWidthPixels = metrics.width * 0.5;
  const fallbackHalfHeightPixels =
    ((metrics.actualBoundingBoxAscent || 0) + (metrics.actualBoundingBoxDescent || 0)) * 0.5 ||
    6;
  const leftPixels = Number.isFinite(metrics.actualBoundingBoxLeft)
    ? metrics.actualBoundingBoxLeft
    : fallbackHalfWidthPixels;
  const rightPixels = Number.isFinite(metrics.actualBoundingBoxRight)
    ? metrics.actualBoundingBoxRight
    : fallbackHalfWidthPixels;
  const topPixels = Number.isFinite(metrics.actualBoundingBoxAscent)
    ? metrics.actualBoundingBoxAscent
    : fallbackHalfHeightPixels;
  const bottomPixels = Number.isFinite(metrics.actualBoundingBoxDescent)
    ? metrics.actualBoundingBoxDescent
    : fallbackHalfHeightPixels;

  return {
    halfWidth: (leftPixels + rightPixels) * 0.5 / scalePixels,
    halfHeight: (topPixels + bottomPixels) * 0.5 / scalePixels,
    alignOffsetPixels: {
      x: (leftPixels - rightPixels) * 0.5,
      y: (topPixels - bottomPixels) * 0.5,
    },
    alignOffsetWorld: {
      x: (leftPixels - rightPixels) * 0.5 / scalePixels,
      y: (topPixels - bottomPixels) * 0.5 / scalePixels,
    },
  };
}

function drawEigenlines(eigenData, theme) {
  if (!eigenData.real) {
    return;
  }

  if (eigenData.allDirections) {
    ctx.save();
    ctx.strokeStyle = theme.eigenLineSoft;
    ctx.lineWidth = 1.3;
    ctx.setLineDash([5, 8]);
    for (let angle = 0; angle < Math.PI; angle += Math.PI / 6) {
      const direction = { x: Math.cos(angle), y: Math.sin(angle) };
      drawInfiniteLine(direction);
    }
    ctx.restore();
    return;
  }

  eigenData.eigenpairs.forEach((pair) => {
    ctx.save();
    ctx.strokeStyle = theme.eigenLine;
    ctx.lineWidth = 1.9;
    ctx.setLineDash([10, 8]);
    drawInfiniteLine(pair.vector);
    ctx.restore();

    const labelPoint = scale(pair.vector, 4.35);
    drawTag(labelPoint, `λ = ${formatNumber(pair.value)}`, theme.eigenTagBg, theme.tagInk);
  });
}

function drawProbeGuide(vector, theme) {
  ctx.save();
  ctx.strokeStyle = theme.probeLine;
  ctx.lineWidth = 1.9;
  ctx.setLineDash([8, 7]);
  drawInfiniteLine(vector);
  ctx.restore();
}

function drawBasisVectors(matrix, theme) {
  const e1 = { x: matrix.a, y: matrix.c };
  const e2 = { x: matrix.b, y: matrix.d };
  drawArrow(e1, {
    color: theme.basisE1,
    width: 2.2,
    label: "T(e1)",
    headSize: 14,
    tagFill: theme.tagBg,
    tagInk: theme.tagInk,
  });
  drawArrow(e2, {
    color: theme.basisE2,
    width: 2.2,
    label: "T(e2)",
    headSize: 14,
    tagFill: theme.tagBg,
    tagInk: theme.tagInk,
  });
  drawHandle(e1, {
    fill: theme.basisE1Handle,
    stroke: theme.handleStroke,
    radius: 7.8,
  });
  drawHandle(e2, {
    fill: theme.basisE2Handle,
    stroke: theme.handleStroke,
    radius: 7.8,
  });
  drawArrowHead(e1, {
    color: theme.basisE1,
    headSize: 14,
  });
  drawArrowHead(e2, {
    color: theme.basisE2,
    headSize: 14,
  });
}

function drawProjection(projected, image, theme) {
  const distance = length(subtract(image, projected));
  if (distance < 0.04) {
    return;
  }

  ctx.save();
  ctx.strokeStyle = theme.projectionLine;
  ctx.lineWidth = 1.4;
  ctx.setLineDash([5, 6]);
  drawWorldLine(projected, image, { stroke: theme.projectionLine, width: 1.4 });
  ctx.restore();
}

function drawArrow(vector, options) {
  const start = worldToScreen({ x: 0, y: 0 });

  ctx.save();
  ctx.strokeStyle = options.color;
  ctx.fillStyle = options.color;
  ctx.lineWidth = options.width;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(worldToScreen(vector).x, worldToScreen(vector).y);
  ctx.stroke();
  drawArrowHead(vector, options);

  if (options.label && length(vector) > EPSILON) {
    const direction = normalize(vector);
    const labelPoint = add(vector, scale(direction, 0.35));
    drawTag(labelPoint, options.label, options.tagFill, options.tagInk);
  }

  ctx.restore();
}

function drawArrowHead(vector, options) {
  if (length(vector) < EPSILON) {
    return;
  }

  const start = worldToScreen({ x: 0, y: 0 });
  const end = worldToScreen(vector);
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const headSize = options.headSize || 10;

  ctx.save();
  ctx.fillStyle = options.color;
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(
    end.x - headSize * Math.cos(angle - Math.PI / 7),
    end.y - headSize * Math.sin(angle - Math.PI / 7)
  );
  ctx.lineTo(
    end.x - headSize * Math.cos(angle + Math.PI / 7),
    end.y - headSize * Math.sin(angle + Math.PI / 7)
  );
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawHandle(point, options = {}) {
  const screen = worldToScreen(point);
  ctx.save();
  ctx.fillStyle = options.fill || "rgba(216, 154, 34, 1)";
  ctx.strokeStyle = options.stroke || "rgba(255, 255, 255, 0.95)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, options.radius || 8.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawOrigin(theme) {
  const center = worldToScreen({ x: 0, y: 0 });
  ctx.save();
  ctx.fillStyle = theme.originFill;
  ctx.beginPath();
  ctx.arc(center.x, center.y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawInfiniteLine(direction) {
  const unit = normalize(direction);
  if (length(unit) < EPSILON) {
    return;
  }
  const start = scale(unit, -WORLD_RANGE * 1.4);
  const end = scale(unit, WORLD_RANGE * 1.4);
  drawWorldLine(start, end, { stroke: ctx.strokeStyle, width: ctx.lineWidth });
}

function drawWorldLine(start, end, style) {
  const a = worldToScreen(start);
  const b = worldToScreen(end);
  ctx.save();
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = style.width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

function drawTag(worldPoint, text, fill, ink = "rgba(18, 32, 44, 0.95)") {
  const point = worldToScreen(worldPoint);
  ctx.save();
  ctx.font = '600 14px "Avenir Next", "Segoe UI", sans-serif';
  const metrics = ctx.measureText(text);
  const paddingX = 8;
  const paddingY = 6;
  const x = point.x - metrics.width / 2 - paddingX;
  const y = point.y - 16;
  const width = metrics.width + paddingX * 2;
  const height = 26;
  ctx.fillStyle = fill;
  roundRect(ctx, x, y, width, height, 12);
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.fillText(text, x + paddingX, y + 17);
  ctx.restore();
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function computeEigenData(matrix) {
  const trace = matrix.a + matrix.d;
  const det = matrix.a * matrix.d - matrix.b * matrix.c;
  const discriminant = trace * trace - 4 * det;

  if (discriminant < -EPSILON) {
    return {
      trace,
      det,
      discriminant,
      real: false,
      allDirections: false,
      repeated: false,
      eigenpairs: [],
      realLineLabel: "0",
      complexRealPart: trace / 2,
      complexImagPart: Math.sqrt(-discriminant) / 2,
    };
  }

  const adjustedDisc = Math.abs(discriminant) < EPSILON ? 0 : discriminant;
  const root = Math.sqrt(Math.max(0, adjustedDisc));
  const lambda1 = (trace + root) / 2;
  const lambda2 = (trace - root) / 2;
  const repeated = Math.abs(lambda1 - lambda2) < 1e-7;
  const scalarIdentity =
    Math.abs(matrix.b) < EPSILON &&
    Math.abs(matrix.c) < EPSILON &&
    Math.abs(matrix.a - lambda1) < EPSILON &&
    Math.abs(matrix.d - lambda1) < EPSILON;

  if (scalarIdentity) {
    return {
      trace,
      det,
      discriminant: adjustedDisc,
      real: true,
      allDirections: true,
      repeated: true,
      eigenpairs: [{ value: lambda1, vector: { x: 1, y: 0 } }],
      realLineLabel: "all",
    };
  }

  if (repeated) {
    return {
      trace,
      det,
      discriminant: adjustedDisc,
      real: true,
      allDirections: false,
      repeated: true,
      eigenpairs: [{ value: lambda1, vector: computeEigenvector(matrix, lambda1) }],
      realLineLabel: "1",
    };
  }

  return {
    trace,
    det,
    discriminant: adjustedDisc,
    real: true,
    allDirections: false,
    repeated: false,
    eigenpairs: [
      { value: lambda1, vector: computeEigenvector(matrix, lambda1) },
      { value: lambda2, vector: computeEigenvector(matrix, lambda2) },
    ],
    realLineLabel: "2",
  };
}

function computeEigenvector(matrix, eigenvalue) {
  const row1 = { x: matrix.a - eigenvalue, y: matrix.b };
  const row2 = { x: matrix.c, y: matrix.d - eigenvalue };
  const useRow1 = length(row1) >= length(row2);
  const base = useRow1 ? row1 : row2;
  let vector = { x: base.y, y: -base.x };

  if (length(vector) < EPSILON) {
    vector = useRow1 ? { x: row2.y, y: -row2.x } : { x: row1.y, y: -row1.x };
  }

  if (length(vector) < EPSILON) {
    vector = { x: 1, y: 0 };
  }

  vector = normalize(vector);
  if (vector.x < -EPSILON || (Math.abs(vector.x) < EPSILON && vector.y < 0)) {
    vector = scale(vector, -1);
  }

  return vector;
}

function buildEigenSummary(eigenData) {
  if (!eigenData.real) {
    return `
      <strong>No real eigenvectors.</strong>
      The characteristic polynomial has complex roots, so no real line stays fixed in the plane.
    `;
  }

  if (eigenData.allDirections) {
    return `
      <strong>Every non-zero direction is an eigenvector.</strong>
      This matrix acts like a pure scaling, so the entire plane already points along eigenlines.
    `;
  }

  if (eigenData.repeated) {
    return `
      <strong>One visible eigenline.</strong>
      The eigenvalue repeats, but only one real direction survives as a line that maps to itself.
    `;
  }

  return `
    <strong>Two distinct real eigenlines.</strong>
    Most vectors bend away, but these two directions only stretch or flip.
  `;
}

function buildEigenDetails(eigenData) {
  if (!eigenData.real) {
    return `
      <div class="detail-item">
        <h4>Complex pair</h4>
        <p>
          &lambda; = ${formatNumber(eigenData.complexRealPart)}
          +/- ${formatNumber(eigenData.complexImagPart)}i
        </p>
      </div>
    `;
  }

  if (eigenData.allDirections) {
    return `
      <div class="detail-item">
        <h4>Repeated eigenvalue</h4>
        <p>&lambda; = ${formatNumber(eigenData.eigenpairs[0].value)} for every non-zero vector.</p>
      </div>
    `;
  }

  return eigenData.eigenpairs
    .map((pair, index) => {
      const vector = pair.vector;
      return `
        <div class="detail-item">
          <h4>Eigenpair ${index + 1}</h4>
          <p>
            &lambda; = ${formatNumber(pair.value)},
            direction approx (${formatNumber(vector.x)}, ${formatNumber(vector.y)})
          </p>
        </div>
      `;
    })
    .join("");
}

function buildNoticeText(eigenData, drift, alongScale, slip) {
  if (supportsGeometricAction(state.matrix) && state.motionMode === "geometric-action") {
    return "Geometric action is active: the plane is rotating by angle rather than blending matrix entries, so the unit circle keeps radius 1 throughout the motion.";
  }

  if (supportsGeometricAction(state.matrix) && state.motionMode === "matrix-morph") {
    return "Matrix morph is active: the coefficients are blending from I to A, so this path briefly introduces scaling even though the final matrix is a pure rotation.";
  }

  if (!eigenData.real) {
    return "The orange image always slides off the gold guide here. Rotation dominates, so the invariant directions only appear after extending the problem into the complex plane.";
  }

  if (eigenData.allDirections) {
    return `Every probe direction works. The current one stays on its span with scale ${formatNumber(alongScale)} and essentially zero off-span slip.`;
  }

  if (drift < 0.8) {
    if (alongScale < 0) {
      return `You found an eigenline. The image stays on the same span but flips through the origin with eigenvalue about ${formatNumber(alongScale)}.`;
    }
    return `You found an eigenline. The image stays on the same span and scales by about ${formatNumber(alongScale)}.`;
  }

  if (eigenData.repeated) {
    return `Only one real line works in this repeated-root case. Your current probe misses it by ${formatNumber(drift)} degrees and slips ${formatNumber(slip)} units off the span.`;
  }

  return `This probe direction misses the eigenlines by ${formatNumber(drift)} degrees, so the transformation mixes it with another direction instead of just scaling it.`;
}

function buildCanvasNote(eigenData, drift) {
  const progressPercent = Math.round(state.progress * 100);
  if (supportsGeometricAction(state.matrix) && state.motionMode === "geometric-action") {
    return `t = ${progressPercent}%. Geometric action rotates by angle directly, so the unit circle stays radius 1 while the plane turns toward the target rotation.`;
  }

  if (supportsGeometricAction(state.matrix) && state.motionMode === "matrix-morph") {
    return `t = ${progressPercent}%. Matrix morph blends entries from I to A, so the circle can shrink mid-path even though the destination is a pure rotation.`;
  }

  if (!eigenData.real) {
    return `t = ${progressPercent}%. The dashed gold line is only a probe span now; no real eigenline exists for the target matrix.`;
  }

  if (eigenData.allDirections) {
    return `t = ${progressPercent}%. Identity and the target matrix share every direction, so the entire animation preserves all spans.`;
  }

  if (drift < 0.8) {
    return `t = ${progressPercent}%. Because the interpolation uses I + t(A - I), any final eigenvector remains on its span during the whole animation.`;
  }

  return `t = ${progressPercent}%. Drag the gold handle until the orange image collapses back onto the gold guide; that is the geometric signature of an eigenvector.`;
}

function formatCharacteristicPolynomial(trace, det) {
  const parts = ["p(λ) = λ^2"];
  const linearCoefficient = -trace;
  if (Math.abs(linearCoefficient) >= EPSILON) {
    const sign = linearCoefficient >= 0 ? " + " : " - ";
    const magnitude = Math.abs(linearCoefficient);
    const coefficient = Math.abs(magnitude - 1) < EPSILON ? "" : formatNumber(magnitude);
    parts.push(`${sign}${coefficient}λ`);
  }

  if (Math.abs(det) >= EPSILON) {
    const sign = det >= 0 ? " + " : " - ";
    parts.push(`${sign}${formatNumber(Math.abs(det))}`);
  }

  return parts.join("");
}

function interpolateMatrix(matrix, progress) {
  return {
    a: 1 + progress * (matrix.a - 1),
    b: progress * matrix.b,
    c: progress * matrix.c,
    d: 1 + progress * (matrix.d - 1),
  };
}

function getAnimatedMatrix() {
  if (state.motionMode === "geometric-action" && supportsGeometricAction(state.matrix)) {
    return interpolateRotationMatrix(state.matrix, state.progress);
  }

  return interpolateMatrix(state.matrix, state.progress);
}

function interpolateRotationMatrix(matrix, progress) {
  const angle = Math.atan2(matrix.c, matrix.a) * progress;
  return {
    a: Math.cos(angle),
    b: -Math.sin(angle),
    c: Math.sin(angle),
    d: Math.cos(angle),
  };
}

function applyMatrix(matrix, vector) {
  return {
    x: matrix.a * vector.x + matrix.b * vector.y,
    y: matrix.c * vector.x + matrix.d * vector.y,
  };
}

function computeSpanDrift(a, b) {
  return radiansToDegrees(Math.atan2(Math.abs(cross(a, b)), Math.abs(dot(a, b))));
}

function worldToScreen(point) {
  const scalePixels = getWorldScalePixels();
  return {
    x: state.size.width / 2 + point.x * scalePixels,
    y: state.size.height / 2 - point.y * scalePixels,
  };
}

function screenToWorld(x, y) {
  const scalePixels = getWorldScalePixels();
  return {
    x: (x - state.size.width / 2) / scalePixels,
    y: -(y - state.size.height / 2) / scalePixels,
  };
}

function getWorldScalePixels() {
  return Math.min(state.size.width, state.size.height) / (WORLD_RANGE * 2);
}

function ensureNonZeroVector() {
  if (length(state.vector) < 0.18) {
    state.vector.x = 0.35;
    state.vector.y = 0.35;
  }
}

function sanitizeNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function bindNumericInput(input, onCommit) {
  const commit = () => {
    const raw = input.value.trim();
    if (raw === "" || raw === "-" || raw === "." || raw === "-.") {
      syncInputsFromState();
      return;
    }

    const value = sanitizeNumber(raw);
    onCommit(value);
  };

  input.addEventListener("change", commit);
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      commit();
      input.blur();
    }
  });
}

function buildModeHint() {
  if (supportsGeometricAction(state.matrix)) {
    if (state.motionMode === "geometric-action") {
      return "Geometric action is showing the clean rotational story: lengths stay fixed while angles advance toward the target matrix.";
    }

    return "Matrix morph is showing the coefficient path from I to A. Switch to Geometric action to compare it with a true rotation.";
  }

  return "Geometric action is only enabled for pure rotations. This matrix is currently shown as a matrix morph.";
}

function supportsGeometricAction(matrix) {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  const column1Length = Math.hypot(matrix.a, matrix.c);
  const column2Length = Math.hypot(matrix.b, matrix.d);
  const dotProduct = matrix.a * matrix.b + matrix.c * matrix.d;
  const tolerance = 0.03;

  return (
    Math.abs(determinant - 1) < tolerance &&
    Math.abs(column1Length - 1) < tolerance &&
    Math.abs(column2Length - 1) < tolerance &&
    Math.abs(dotProduct) < tolerance
  );
}

function canonicalizeMotionMode() {
  if (state.motionMode === "geometric-action" && !supportsGeometricAction(state.matrix)) {
    state.motionMode = "matrix-morph";
  }
}

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return "0";
  }

  const rounded = Math.abs(value) < 1e-9 ? 0 : value;
  return rounded.toFixed(Math.abs(rounded) >= 10 ? 1 : 2).replace(/\.?0+$/, "");
}

function formatInput(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function radiansToDegrees(radians) {
  return (radians * 180) / Math.PI;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

function scale(vector, factor) {
  return { x: vector.x * factor, y: vector.y * factor };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

function length(vector) {
  return Math.hypot(vector.x, vector.y);
}

function normalize(vector) {
  const magnitude = length(vector);
  if (magnitude < EPSILON) {
    return { x: 0, y: 0 };
  }
  return scale(vector, 1 / magnitude);
}

init();

/**
 * Cinematic Player — Scroll-driven frame sequence renderer
 *
 * Architecture:
 *   - Progressive loading: first 40 frames immediately, rest in background
 *   - Canvas 2D rendering with requestAnimationFrame
 *   - Only redraws when frame index changes
 *   - Retina display support via devicePixelRatio
 *   - Cover sizing (preserves aspect ratio, fills viewport)
 *   - Shows nearest available frame if target not yet loaded
 *
 * @module CinematicPlayer
 */

console.log('[CinematicPlayer] Script loaded');

const CinematicPlayer = (() => {
  'use strict';

  // State
  let canvas = null;
  let ctx = null;
  let manifest = null;
  let frameCache = [];
  let loadedCount = 0;
  let currentFrameIndex = -1;
  let targetFrameIndex = 0;
  let isReady = false;
  let animationFrameId = null;
  let scrollTriggerInstance = null;

  // DOM elements
  let loader = null;
  let loaderFill = null;
  let loaderLabel = null;

  // Configuration
  let config = {
    canvasId: 'reelCanvas',
    loaderId: 'reelLoader',
    loaderFillId: 'reelLoaderFill',
    loaderLabelId: 'reelLoaderLabel',
    manifestUrl: 'assets/frames/manifest.json',
    initialFrameCount: 40
  };

  /**
   * Initialize the cinematic player
   */
  async function init(options = {}) {
    console.log('[CinematicPlayer] Initializing...');

    // Merge config
    config = { ...config, ...options };

    // Get DOM elements
    canvas = document.getElementById(config.canvasId);
    loader = document.getElementById(config.loaderId);
    loaderFill = document.getElementById(config.loaderFillId);
    loaderLabel = document.getElementById(config.loaderLabelId);

    if (!canvas) {
      console.error('[CinematicPlayer] Canvas element not found:', config.canvasId);
      return;
    }
    console.log('[CinematicPlayer] Canvas found');

    // Get 2D context
    ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('[CinematicPlayer] Could not get 2D context');
      return;
    }

    // Enable image smoothing
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Load manifest
    try {
      console.log('[CinematicPlayer] Loading manifest from:', config.manifestUrl);
      manifest = await loadManifest(config.manifestUrl);
      console.log('[CinematicPlayer] Manifest loaded:', manifest.frameCount, 'frames');
    } catch (error) {
      console.error('[CinematicPlayer] Failed to load manifest:', error);
      hideLoader();
      return;
    }

    // Initialize frame cache
    frameCache = new Array(manifest.frameCount).fill(null);

    // Delay initial resize until after layout is settled
    await new Promise(resolve => requestAnimationFrame(() => {
      resizeCanvas();
      console.log('[CinematicPlayer] Canvas resized');
      resolve();
    }));

    // Setup ResizeObserver for reliable resize detection
    const resizeObserver = new ResizeObserver(debounce(resizeCanvas, 100));
    resizeObserver.observe(canvas);

    // Fallback for older browsers
    window.addEventListener('resize', debounce(resizeCanvas, 150));

    // Start progressive loading
    console.log('[CinematicPlayer] Starting progressive loading...');
    await loadFramesProgressively();

    // Setup scroll trigger
    console.log('[CinematicPlayer] Setting up ScrollTrigger...');
    setupScrollTrigger();

    // Start render loop
    console.log('[CinematicPlayer] Starting render loop...');
    startRenderLoop();

    console.log('[CinematicPlayer] Initialization complete');
  }

  /**
   * Load manifest.json
   */
  async function loadManifest(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  }

  /**
   * Progressive frame loading
   */
  async function loadFramesProgressively() {
    const totalFrames = manifest.frameCount;
    const initialCount = Math.min(config.initialFrameCount, totalFrames);

    console.log(`[CinematicPlayer] Loading first ${initialCount} frames...`);

    // Load first batch immediately
    const initialPromises = [];
    for (let i = 0; i < initialCount; i++) {
      initialPromises.push(loadFrame(i));
    }

    // Wait for first frame to show something
    console.log('[CinematicPlayer] Waiting for first frame...');
    await Promise.race(initialPromises);
    console.log('[CinematicPlayer] First frame loaded, displaying...');
    showFirstFrame();

    // Wait for initial batch
    console.log('[CinematicPlayer] Waiting for initial batch...');
    await Promise.all(initialPromises);
    console.log('[CinematicPlayer] Initial batch complete');

    // Show loader completion
    updateLoader(100, 'Ready');
    setTimeout(hideLoader, 300);

    // Mark as ready
    isReady = true;
    console.log('[CinematicPlayer] Ready! Loaded', loadedCount, 'frames');

    // Load remaining frames in background
    if (initialCount < totalFrames) {
      console.log(`[CinematicPlayer] Loading remaining ${totalFrames - initialCount} frames in background...`);
      loadRemainingFrames(initialCount);
    }
  }

  /**
   * Load a single frame
   */
  function loadFrame(index) {
    return new Promise((resolve, reject) => {
      if (frameCache[index]) {
        resolve(frameCache[index]);
        return;
      }

      const img = new Image();
      const BASE_PATH = 'assets/frames/';
      const frameName = manifest.frames[index];
      const frameUrl = BASE_PATH + frameName;

      img.onload = () => {
        frameCache[index] = img;
        loadedCount++;
        updateLoaderProgress();
        if (index < 5 || index % 50 === 0) {
          console.log(`[CinematicPlayer] Loaded frame ${index}: ${frameUrl}`);
        }
        resolve(img);
      };

      img.onerror = (e) => {
        console.error(`[CinematicPlayer] Failed to load frame ${index}: ${frameUrl}`, e);
        reject(new Error(`Frame ${index} failed to load`));
      };

      img.src = frameUrl;
    });
  }

  /**
   * Load remaining frames in background
   */
  function loadRemainingFrames(startIndex) {
    const totalFrames = manifest.frameCount;
    const batchSize = 10;

    function loadBatch(index) {
      if (index >= totalFrames) return;

      const batch = [];
      for (let i = index; i < Math.min(index + batchSize, totalFrames); i++) {
        batch.push(loadFrame(i));
      }

      Promise.all(batch).then(() => {
        // Continue with next batch
        requestAnimationFrame(() => loadBatch(index + batchSize));
      });
    }

    loadBatch(startIndex);
  }

  /**
   * Show first frame as soon as it's available
   */
  function showFirstFrame() {
    if (frameCache[0]) {
      drawFrame(0);
    }
  }

  /**
   * Update loader progress
   */
  function updateLoaderProgress() {
    if (!manifest) return;
    const percent = Math.round((loadedCount / manifest.frameCount) * 100);
    updateLoader(percent, `Loading ${percent}%`);
  }

  /**
   * Update loader display
   */
  function updateLoader(percent, label) {
    if (loaderFill) {
      loaderFill.style.width = `${percent}%`;
    }
    if (loaderLabel) {
      loaderLabel.textContent = label;
    }
  }

  /**
   * Hide loader
   */
  function hideLoader() {
    if (loader) {
      loader.classList.add('is-hidden');
    }
  }

  /**
   * Resize canvas for Retina displays
   * Uses explicit pixel dimensions to avoid any CSS/layout issues
   */
  function resizeCanvas() {
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;

    // Use offsetWidth/offsetHeight which are more reliable than getBoundingClientRect
    const displayWidth = canvas.offsetWidth;
    const displayHeight = canvas.offsetHeight;

    // Skip if canvas has no size yet (before layout)
    if (displayWidth === 0 || displayHeight === 0) {
      console.log('[CinematicPlayer] Skipping resize - canvas has no size yet');
      return;
    }

    const bufferWidth = Math.round(displayWidth * dpr);
    const bufferHeight = Math.round(displayHeight * dpr);

    // Only resize if dimensions actually changed
    if (canvas.width === bufferWidth && canvas.height === bufferHeight) {
      console.log('[CinematicPlayer] Canvas size unchanged, skipping resize');
      return;
    }

    console.log(`[CinematicPlayer] Resizing canvas: display=${displayWidth}x${displayHeight}, buffer=${bufferWidth}x${bufferHeight}, dpr=${dpr}`);

    // Set canvas buffer size (this clears the canvas)
    canvas.width = bufferWidth;
    canvas.height = bufferHeight;

    // Reset transform then scale - prevents cumulative blur
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Redraw current frame if we have one
    if (currentFrameIndex >= 0 && frameCache[currentFrameIndex]) {
      console.log('[CinematicPlayer] Redrawing current frame after resize');
      drawFrame(currentFrameIndex);
    }
  }

  /**
   * Draw frame to canvas with cover sizing
   */
  function drawFrame(index) {
    if (!canvas || !ctx || !frameCache[index]) {
      console.log('[CinematicPlayer] drawFrame: missing canvas, ctx, or frame');
      return;
    }

    const img = frameCache[index];

    // Use canvas buffer dimensions divided by DPR for drawing coordinates
    const dpr = window.devicePixelRatio || 1;
    const canvasWidth = canvas.width / dpr;
    const canvasHeight = canvas.height / dpr;

    // Skip if canvas has no size
    if (canvasWidth === 0 || canvasHeight === 0) {
      console.log('[CinematicPlayer] drawFrame: canvas has no size');
      return;
    }

    console.log(`[CinematicPlayer] drawFrame(${index}): img=${img.width}x${img.height}, canvas=${canvasWidth}x${canvasHeight}, dpr=${dpr}`);

    // Calculate cover sizing (like object-fit: cover)
    const imgAspect = img.width / img.height;
    const canvasAspect = canvasWidth / canvasHeight;

    let drawWidth, drawHeight, drawX, drawY;

    if (imgAspect > canvasAspect) {
      // Image is wider - fit height, crop width
      drawHeight = canvasHeight;
      drawWidth = drawHeight * imgAspect;
      drawX = (canvasWidth - drawWidth) / 2;
      drawY = 0;
    } else {
      // Image is taller - fit width, crop height
      drawWidth = canvasWidth;
      drawHeight = drawWidth / imgAspect;
      drawX = 0;
      drawY = (canvasHeight - drawHeight) / 2;
    }

    console.log(`[CinematicPlayer] drawFrame: drawing at ${drawX},${drawY} size ${drawWidth}x${drawHeight}`);

    // Clear entire canvas buffer
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    // Draw image
    ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);

    currentFrameIndex = index;
    console.log('[CinematicPlayer] Frame drawn successfully');
  }

  /**
   * Find nearest available frame
   */
  function findNearestFrame(targetIndex) {
    if (frameCache[targetIndex]) {
      return targetIndex;
    }

    // Search outward from target
    for (let offset = 1; offset < manifest.frameCount; offset++) {
      const lower = targetIndex - offset;
      const upper = targetIndex + offset;

      if (lower >= 0 && frameCache[lower]) {
        return lower;
      }
      if (upper < manifest.frameCount && frameCache[upper]) {
        return upper;
      }
    }

    return -1;
  }

  /**
   * Setup GSAP ScrollTrigger
   */
  function setupScrollTrigger() {
    if (!window.gsap || !window.ScrollTrigger) {
      console.error('[CinematicPlayer] GSAP or ScrollTrigger not found');
      return;
    }

    scrollTriggerInstance = ScrollTrigger.create({
      trigger: '.video-reel',
      start: 'top top',
      end: 'bottom bottom',
      pin: '.video-reel__sticky',
      pinSpacing: false,
      scrub: 0.2,
      onUpdate: (self) => {
        // Map scroll progress to frame index
        const frameIndex = Math.round(self.progress * (manifest.frameCount - 1));
        targetFrameIndex = Math.max(0, Math.min(manifest.frameCount - 1, frameIndex));
      }
    });
  }

  /**
   * Render loop using requestAnimationFrame
   */
  function startRenderLoop() {
    function render() {
      if (!isReady) {
        animationFrameId = requestAnimationFrame(render);
        return;
      }

      // Safety check: if canvas dimensions changed (e.g. zoom), resize first
      const displayWidth = canvas.offsetWidth;
      const displayHeight = canvas.offsetHeight;
      if (displayWidth > 0 && displayHeight > 0) {
        const dpr = window.devicePixelRatio || 1;
        const expectedWidth = Math.round(displayWidth * dpr);
        const expectedHeight = Math.round(displayHeight * dpr);
        if (canvas.width !== expectedWidth || canvas.height !== expectedHeight) {
          console.log('[CinematicPlayer] Render loop: canvas size mismatch, resizing');
          resizeCanvas();
        }
      }

      // Only redraw if frame index changed
      if (targetFrameIndex !== currentFrameIndex) {
        const frameToDraw = findNearestFrame(targetFrameIndex);
        if (frameToDraw >= 0) {
          drawFrame(frameToDraw);
        }
      }

      animationFrameId = requestAnimationFrame(render);
    }

    render();
  }

  /**
   * Debounce utility
   */
  function debounce(fn, delay) {
    let timeoutId;
    return function (...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // Public API
  return {
    init
  };
})();

// Expose to global scope
window.CinematicPlayer = CinematicPlayer;
console.log('[CinematicPlayer] Module initialized, window.CinematicPlayer:', window.CinematicPlayer);

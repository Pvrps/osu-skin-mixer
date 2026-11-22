import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Adjustment,
  NO_ADJUSTMENT,
  type Region,
  type Rgba,
  adjust,
  clear,
  contentBounds,
  floodFill,
  greyscale,
  hexToRgb,
  invert,
  isAdjusted,
  pixelAt,
  replaceColour,
  rgbToHex,
} from "../editor/pixels";
import { saveEdited } from "../lib/api";
import type { Recolour } from "../lib/recolour";
import { fileUrl } from "../lib/skins";
import { FloatingWindow } from "./FloatingWindow";

/** One image of the element being edited. An element can have several: its `@2x` version, and animation frames. */
export interface EditorFile {
  name: string;
  /** The hash of the skin's own file, which an edit is recorded against. */
  original: string;
  /** The hash of what is in the mix now: the last saved edit, or the original. */
  current: string;
  /** The name shared by a file and its `@2x` version. */
  stem: string;
  hd: boolean;
}

interface Props {
  /** What the element is called, for the window's title. */
  title: string;
  files: EditorFile[];
  /** The recolouring set on this element, if any. It is done to whatever comes out of here. */
  recolour: Recolour | null;
  onSave: (original: string, edited: string) => void;
  onRevert: (original: string) => void;
  onClose: () => void;
}

type Tool = "brush" | "eraser" | "fill" | "replace" | "picker" | "select" | "shape" | "hand";
type Shape = "line" | "rectangle" | "ellipse";

const TOOLS: { id: Tool; label: string; key: string; hint: string; icon: React.ReactNode }[] = [
  { id: "brush", label: "Brush", key: "B", hint: "Drag to paint.", icon: <path d="M11.5 1.5l3 3-7.5 7.5-3.5.5.5-3.5zM3 13.5c-.8.8-2 .8-2 .8s0-1.200.800-2" /> },
  { id: "eraser", label: "Eraser", key: "E", hint: "Drag to rub out.", icon: <path d="M9.500 2.500l4 4-6.500 6.500h-3l-2-2zM5.500 6.500l4 4M6 14.500h8" /> },
  { id: "fill", label: "Fill", key: "G", hint: "Click an area to paint it over in one flat colour. Works on empty areas too.", icon: <path d="M7 1.500l6 6-5 5a1.400 1.400 0 01-2 0l-4-4a1.400 1.400 0 010-2zM2.500 7.500h9.500M14 10.500s1.200 1.600 1.200 2.500a1.200 1.200 0 01-2.400 0c0-.900 1.200-2.500 1.200-2.500z" /> },
  { id: "replace", label: "Replace colour", key: "R", hint: "Click a colour to turn it into yours wherever it appears, keeping its shading and soft edges.", icon: <path d="M2 5.500a3 3 0 106 0 3 3 0 10-6 0M9 11a2.500 2.500 0 105 0 2.500 2.500 0 10-5 0M10.500 3h3.500v3.500M14 3l-4.500 4.500" /> },
  { id: "picker", label: "Pick colour", key: "I", hint: "Click to take a colour from the image. Alt-click does this with any tool.", icon: <path d="M10.500 2a2 2 0 013 3l-1.500 1.500.800.800-1 1-.800-.800-5.500 5.500-2.500.500.500-2.500 5.500-5.500-.800-.800 1-1 .800.800z" /> },
  { id: "select", label: "Select", key: "M", hint: "Drag to mark out an area. Other tools then only work inside it.", icon: <path d="M2 2h3M7 2h2M11 2h3v3M14 7v2M14 11v3h-3M9 14H7M5 14H2v-3M2 9V7M2 5V2" /> },
  { id: "shape", label: "Shape", key: "U", hint: "Drag to draw. Hold Shift for a square, a circle or a straight angle.", icon: <path d="M2 6.500h7.500v7.500H2zM6.500 5.500a4 4 0 117.500 2" /> },
  { id: "hand", label: "Move view", key: "H", hint: "Drag to move around. Holding Space does this with any tool.", icon: <path d="M5 8V3.500a1 1 0 012 0V7M7 7V2.500a1 1 0 012 0V7M9 7V3.500a1 1 0 012 0V8M11 8V5.500a1 1 0 012 0V10a4.500 4.500 0 01-4.500 4.500A4.500 4.500 0 014.500 12L2.500 9a1 1 0 011.600-1.200L5 9" /> },
];

type Tab = "tool" | "adjust" | "image";

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: "tool", label: "Tool", hint: "Settings for the tool in use" },
  { id: "adjust", label: "Adjust", hint: "Hue, saturation, brightness and opacity" },
  { id: "image", label: "Image", hint: "Flip, rotate, trim and resize" },
];

/** How much history is kept, by the memory it takes up. Skin images are small, so this is a great many steps. */
const HISTORY_BYTES = 256 * 1024 * 1024;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 64;
/** From this zoom on, the edges of individual pixels are drawn. */
const GRID_FROM_ZOOM = 12;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** The whole pixels covered by a rectangle dragged between two points. */
function regionBetween(ax: number, ay: number, bx: number, by: number, width: number, height: number): Region {
  const x = clamp(Math.floor(Math.min(ax, bx)), 0, width);
  const y = clamp(Math.floor(Math.min(ay, by)), 0, height);

  return { x, y, width: clamp(Math.ceil(Math.max(ax, bx)), 0, width) - x, height: clamp(Math.ceil(Math.max(ay, by)), 0, height) - y };
}

function makeCanvas(width = 1, height = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

const context = (canvas: HTMLCanvasElement) => canvas.getContext("2d", { willReadFrequently: true })!;

/** The checkerboard which stands for transparency. */
let checker: HTMLCanvasElement | null = null;

function checkerboard(): HTMLCanvasElement {
  if (!checker) {
    checker = makeCanvas(16, 16);
    const ctx = checker.getContext("2d")!;

    ctx.fillStyle = "#2b2a36";
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = "#3a3948";
    ctx.fillRect(0, 0, 8, 8);
    ctx.fillRect(8, 8, 8, 8);
  }

  return checker;
}

export function ImageEditor({ title, files, recolour, onSave, onRevert, onClose }: Props) {
  // The image itself, a layer for the stroke or shape being drawn, and somewhere to combine the two for display.
  const doc = useRef(makeCanvas());
  const layer = useRef(makeCanvas());
  const scratch = useRef(makeCanvas());
  const view = useRef<HTMLCanvasElement>(null);

  /** Where the image sits in the view: how many screen pixels per image pixel, and the offset of its corner. */
  const camera = useRef({ zoom: 1, x: 0, y: 0 });
  const undoStack = useRef<ImageData[]>([]);
  const redoStack = useRef<ImageData[]>([]);
  /** The image as it was before the adjustment sliders were touched, while they are being tried out. */
  const adjustBase = useRef<ImageData | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const spaceHeld = useRef(false);
  const frameRequest = useRef(0);
  /** The hash of what was last saved from here, which is already what is on screen. */
  const lastSaved = useRef<string | null>(null);

  const drag = useRef<
    | { kind: "paint"; lastX: number; lastY: number }
    | { kind: "shape"; startX: number; startY: number }
    | { kind: "select"; startX: number; startY: number; moved: boolean }
    | { kind: "pan"; pointerX: number; pointerY: number; cameraX: number; cameraY: number }
    | null
  >(null);

  const [fileIndex, setFileIndex] = useState(() => Math.max(0, files.findIndex((f) => f.hd)));
  const [tool, setToolOnly] = useState<Tool>("brush");
  const [tab, setTab] = useState<Tab>("tool");

  /** Picking a tool brings up its settings, whichever tab was showing. */
  const setTool = useCallback((next: Tool) => {
    setToolOnly(next);
    setTab("tool");
  }, []);
  const [colour, setColour] = useState("#ff66ab");
  const [opacity, setOpacity] = useState(100);
  const [size, setSize] = useState(8);
  const [tolerance, setTolerance] = useState(20);
  const [contiguous, setContiguous] = useState(true);
  const [shape, setShape] = useState<Shape>("rectangle");
  const [filled, setFilled] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [selection, setSelection] = useState<Region | null>(null);
  const [adjustment, setAdjustment] = useState<Adjustment>(NO_ADJUSTMENT);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [resizeTo, setResizeTo] = useState({ width: "", height: "" });
  const [zoom, setZoom] = useState(1);
  const [hover, setHover] = useState<{ x: number; y: number; colour: Rgba } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [, setHistoryVersion] = useState(0);
  const [alsoStandard, setAlsoStandard] = useState(true);
  const [status, setStatus] = useState<{ kind: "loading" | "ready" | "saving" } | { kind: "error"; message: string }>({ kind: "loading" });

  const file = files[fileIndex] ?? files[0]!;
  const standard = file.hd ? files.find((f) => !f.hd && f.stem === file.stem) : undefined;

  // The handlers below live as long as the canvas does, and read the current settings from here.
  const settings = useRef({ tool, colour, opacity, size, tolerance, contiguous, shape, filled, selection });
  settings.current = { tool, colour, opacity, size, tolerance, contiguous, shape, filled, selection };

  // ---- drawing the view ---------------------------------------------------------------------------------------

  const paint = useCallback(() => {
    const canvas = view.current;
    if (!canvas) return;

    const ratio = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d")!;
    const { zoom, x, y } = camera.current;
    const { width, height } = doc.current;
    const s = settings.current;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Transparency, anchored to the image so it doesn't swim as the view moves.
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width * zoom, height * zoom);
    ctx.clip();
    ctx.translate(x, y);
    ctx.fillStyle = ctx.createPattern(checkerboard(), "repeat")!;
    ctx.fillRect(0, 0, width * zoom, height * zoom);
    ctx.restore();

    // While something is being drawn, show the image as it will be once it is let go.
    let source = doc.current;

    if (drag.current?.kind === "paint" || drag.current?.kind === "shape") {
      const combined = context(scratch.current);

      combined.globalCompositeOperation = "copy";
      combined.drawImage(doc.current, 0, 0);
      combined.globalCompositeOperation = "source-over";
      composeLayer(combined);
      source = scratch.current;
    }

    // Enlarged pixels stay crisp; a shrunken image is smoothed so thin lines don't vanish.
    ctx.imageSmoothingEnabled = zoom < 1;
    ctx.drawImage(source, x, y, width * zoom, height * zoom);

    ctx.strokeStyle = "rgb(255 255 255 / 0.25)";
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x) - 0.5, Math.round(y) - 0.5, Math.round(width * zoom) + 1, Math.round(height * zoom) + 1);

    if (zoom >= GRID_FROM_ZOOM) {
      ctx.beginPath();

      for (let column = 1; column < width; column++) {
        ctx.moveTo(Math.round(x + column * zoom) + 0.5, y);
        ctx.lineTo(Math.round(x + column * zoom) + 0.5, y + height * zoom);
      }

      for (let row = 1; row < height; row++) {
        ctx.moveTo(x, Math.round(y + row * zoom) + 0.5);
        ctx.lineTo(x + width * zoom, Math.round(y + row * zoom) + 0.5);
      }

      ctx.strokeStyle = "rgb(0 0 0 / 0.25)";
      ctx.stroke();
    }

    if (s.selection) {
      const { x: sx, y: sy, width: sw, height: sh } = s.selection;
      const box: [number, number, number, number] = [Math.round(x + sx * zoom) + 0.5, Math.round(y + sy * zoom) + 0.5, Math.round(sw * zoom) - 1, Math.round(sh * zoom) - 1];

      // Two dashed outlines, one in each colour, show up against anything.
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = "#000";
      ctx.strokeRect(...box);
      ctx.lineDashOffset = 5;
      ctx.strokeStyle = "#fff";
      ctx.strokeRect(...box);
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }

    // The outline of the brush, so its reach is clear before anything is put down.
    const at = pointer.current;

    if (at && (s.tool === "brush" || s.tool === "eraser") && !spaceHeld.current) {
      ctx.beginPath();
      ctx.arc(x + at.x * zoom, y + at.y * zoom, Math.max(1, (s.size * zoom) / 2), 0, Math.PI * 2);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }, []);

  const requestPaint = useCallback(() => {
    cancelAnimationFrame(frameRequest.current);
    frameRequest.current = requestAnimationFrame(paint);
  }, [paint]);

  /** Puts what has been drawn on the layer onto an image: painted over it, or rubbed out of it. */
  function composeLayer(target: CanvasRenderingContext2D) {
    const s = settings.current;

    target.save();

    if (s.selection) {
      target.beginPath();
      target.rect(s.selection.x, s.selection.y, s.selection.width, s.selection.height);
      target.clip();
    }

    target.globalAlpha = s.opacity / 100;
    target.globalCompositeOperation = s.tool === "eraser" ? "destination-out" : "source-over";
    target.drawImage(layer.current, 0, 0);
    target.restore();
  }

  // ---- the image and its history ------------------------------------------------------------------------------

  /** Makes the working canvases match the image, after it has been loaded or changed size. */
  const matchSize = useCallback(() => {
    const { width, height } = doc.current;

    for (const canvas of [layer.current, scratch.current]) {
      canvas.width = width;
      canvas.height = height;
    }

    setDimensions({ width, height });
    setResizeTo({ width: String(width), height: String(height) });
  }, []);

  const snapshot = () => context(doc.current).getImageData(0, 0, doc.current.width, doc.current.height);

  const restore = useCallback(
    (image: ImageData) => {
      doc.current.width = image.width;
      doc.current.height = image.height;
      context(doc.current).putImageData(image, 0, 0);
      matchSize();

      // A selection may no longer fit an image of a different size.
      setSelection((current) => (current && (current.x + current.width > image.width || current.y + current.height > image.height) ? null : current));
      requestPaint();
    },
    [matchSize, requestPaint],
  );

  /** Finishes with the adjustment sliders, keeping what they did. */
  const settleAdjustment = useCallback(() => {
    adjustBase.current = null;
    setAdjustment(NO_ADJUSTMENT);
  }, []);

  /** Records the image as it is now, so the change about to be made can be undone. */
  const checkpoint = useCallback(() => {
    settleAdjustment();
    undoStack.current.push(snapshot());
    redoStack.current = [];

    let bytes = undoStack.current.reduce((total, image) => total + image.data.length, 0);

    while (bytes > HISTORY_BYTES && undoStack.current.length > 1) bytes -= undoStack.current.shift()!.data.length;

    setDirty(true);
    setHistoryVersion((v) => v + 1);
  }, [settleAdjustment]);

  const step = useCallback(
    (from: ImageData[], to: ImageData[]) => {
      const image = from.pop();
      if (!image) return;

      settleAdjustment();
      to.push(snapshot());
      restore(image);
      setDirty(true);
      setHistoryVersion((v) => v + 1);
    },
    [restore, settleAdjustment],
  );

  const undo = useCallback(() => step(undoStack.current, redoStack.current), [step]);
  const redo = useCallback(() => step(redoStack.current, undoStack.current), [step]);

  /** Fits the whole image in the view, enlarging small ones so they can be worked on. */
  const fit = useCallback(() => {
    const canvas = view.current;
    if (!canvas) return;

    const { width, height } = doc.current;
    const zoom = clamp(Math.min((canvas.clientWidth - 48) / width, (canvas.clientHeight - 48) / height), MIN_ZOOM, 16);

    camera.current = { zoom, x: (canvas.clientWidth - width * zoom) / 2, y: (canvas.clientHeight - height * zoom) / 2 };
    setZoom(zoom);
    requestPaint();
  }, [requestPaint]);

  /** Zooms in or out, keeping whatever is under a point of the view where it is. */
  const zoomAt = useCallback(
    (factor: number, viewX?: number, viewY?: number) => {
      const canvas = view.current;
      if (!canvas) return;

      const c = camera.current;
      const px = viewX ?? canvas.clientWidth / 2;
      const py = viewY ?? canvas.clientHeight / 2;
      const zoom = clamp(c.zoom * factor, MIN_ZOOM, MAX_ZOOM);

      camera.current = { zoom, x: px - ((px - c.x) / c.zoom) * zoom, y: py - ((py - c.y) / c.zoom) * zoom };
      setZoom(zoom);
      requestPaint();
    },
    [requestPaint],
  );

  // Load whichever of the element's images is being worked on.
  useEffect(() => {
    // Saving makes the saved version the current one. It is what is being worked on already, so it isn't loaded
    // again, which would throw away the undo history.
    if (file.current === lastSaved.current) return;

    let current = true;
    setStatus({ kind: "loading" });

    void fetch(fileUrl({ name: file.name, hash: file.current }))
      .then((response) => (response.ok ? response.blob() : Promise.reject(new Error(`${file.name} couldn't be read.`))))
      .then((blob) => createImageBitmap(blob))
      .then((bitmap) => {
        if (!current) return;

        doc.current.width = bitmap.width;
        doc.current.height = bitmap.height;
        context(doc.current).drawImage(bitmap, 0, 0);
        matchSize();

        undoStack.current = [];
        redoStack.current = [];
        adjustBase.current = null;
        setAdjustment(NO_ADJUSTMENT);
        setSelection(null);
        setDirty(false);
        setHistoryVersion((v) => v + 1);
        setStatus({ kind: "ready" });
        fit();
      })
      .catch((e: Error) => current && setStatus({ kind: "error", message: e.message }));

    return () => {
      current = false;
    };
  }, [file.name, file.current, matchSize, fit]);

  // Keep the view's canvas as sharp as the screen, whatever size the window is dragged to.
  useEffect(() => {
    const canvas = view.current!;

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;

      canvas.width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      paint();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    return () => observer.disconnect();
  }, [paint]);

  useEffect(requestPaint, [selection, tool, size, requestPaint]);

  // ---- changes to the whole image -----------------------------------------------------------------------------

  /** Runs something over the image's pixels, as one step which can be undone. */
  const editPixels = (change: (pixels: ImageData, within: Region | null) => void) => {
    checkpoint();

    const pixels = snapshot();
    change(pixels, settings.current.selection);
    context(doc.current).putImageData(pixels, 0, 0);
    requestPaint();
  };

  /** Replaces the image with a redrawn version of itself, which may be a different size. */
  const redraw = (width: number, height: number, draw: (ctx: CanvasRenderingContext2D, source: HTMLCanvasElement) => void) => {
    checkpoint();

    const source = makeCanvas(doc.current.width, doc.current.height);
    source.getContext("2d")!.drawImage(doc.current, 0, 0);

    doc.current.width = width;
    doc.current.height = height;

    const ctx = context(doc.current);
    ctx.imageSmoothingQuality = "high";
    draw(ctx, source);

    matchSize();
    setSelection(null);
    fit();
  };

  const flip = (horizontal: boolean) =>
    redraw(doc.current.width, doc.current.height, (ctx, source) => {
      ctx.translate(horizontal ? source.width : 0, horizontal ? 0 : source.height);
      ctx.scale(horizontal ? -1 : 1, horizontal ? 1 : -1);
      ctx.drawImage(source, 0, 0);
    });

  const rotate = (clockwise: boolean) =>
    redraw(doc.current.height, doc.current.width, (ctx, source) => {
      ctx.translate(clockwise ? source.height : 0, clockwise ? 0 : source.width);
      ctx.rotate(((clockwise ? 1 : -1) * Math.PI) / 2);
      ctx.drawImage(source, 0, 0);
    });

  const cropTo = (region: Region) => {
    if (region.width < 1 || region.height < 1) return;

    redraw(region.width, region.height, (ctx, source) => ctx.drawImage(source, -region.x, -region.y));
  };

  const trim = () => {
    const bounds = contentBounds(snapshot());
    if (bounds && (bounds.width !== doc.current.width || bounds.height !== doc.current.height)) cropTo(bounds);
  };

  const resize = () => {
    const width = clamp(Math.round(Number(resizeTo.width)) || 0, 1, 8192);
    const height = clamp(Math.round(Number(resizeTo.height)) || 0, 1, 8192);

    if (width === doc.current.width && height === doc.current.height) return;

    redraw(width, height, (ctx, source) => ctx.drawImage(source, 0, 0, width, height));
  };

  /** Typing one side of the new size sets the other to match, keeping the image's shape. */
  const setResize = (side: "width" | "height", value: string) => {
    const other = side === "width" ? "height" : "width";
    const scale = Number(value) / dimensions[side];

    setResizeTo({ [side]: value, [other]: Number(value) > 0 ? String(Math.max(1, Math.round(dimensions[other] * scale))) : resizeTo[other] } as typeof resizeTo);
  };

  /** Tries out the adjustment sliders on the image as it was before they were first moved. */
  const tryAdjustment = (next: Adjustment) => {
    if (!adjustBase.current) {
      checkpoint();
      adjustBase.current = snapshot();
    }

    const pixels = new ImageData(new Uint8ClampedArray(adjustBase.current.data), adjustBase.current.width, adjustBase.current.height);
    adjust(pixels, next, settings.current.selection);
    context(doc.current).putImageData(pixels, 0, 0);

    setAdjustment(next);
    requestPaint();
  };

  const cancelAdjustment = () => {
    if (!adjustBase.current) return;

    // The step recorded when the sliders were first touched is the image without them.
    undoStack.current.pop();
    restore(adjustBase.current);
    settleAdjustment();
    setHistoryVersion((v) => v + 1);
  };

  const remember = (used: string) => setRecent((current) => [used, ...current.filter((c) => c !== used)].slice(0, 10));

  // ---- the pointer --------------------------------------------------------------------------------------------

  /** Where on the image a point of the screen is. */
  const toImage = (e: { clientX: number; clientY: number }) => {
    const bounds = view.current!.getBoundingClientRect();
    const { zoom, x, y } = camera.current;

    return { x: (e.clientX - bounds.left - x) / zoom, y: (e.clientY - bounds.top - y) / zoom };
  };

  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < doc.current.width && y < doc.current.height;

  /** Draws a stretch of a brush stroke onto the layer. A one pixel brush sets whole pixels, with no soft edge. */
  const strokeSegment = (fromX: number, fromY: number, toX: number, toY: number) => {
    const ctx = context(layer.current);
    const s = settings.current;

    ctx.fillStyle = ctx.strokeStyle = s.tool === "eraser" ? "#000" : s.colour;

    if (s.size <= 1) {
      let [x, y] = [Math.floor(fromX), Math.floor(fromY)];
      const [endX, endY] = [Math.floor(toX), Math.floor(toY)];
      const dx = Math.abs(endX - x);
      const dy = -Math.abs(endY - y);
      const stepX = x < endX ? 1 : -1;
      const stepY = y < endY ? 1 : -1;
      let error = dx + dy;

      for (;;) {
        ctx.fillRect(x, y, 1, 1);
        if (x === endX && y === endY) break;

        const doubled = error * 2;

        if (doubled >= dy) {
          error += dy;
          x += stepX;
        }

        if (doubled <= dx) {
          error += dx;
          y += stepY;
        }
      }

      return;
    }

    ctx.lineWidth = s.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    // A stroke which goes nowhere draws nothing, so a click is nudged into being a dot.
    ctx.lineTo(toX === fromX && toY === fromY ? toX + 0.01 : toX, toY);
    ctx.stroke();
  };

  const drawShape = (startX: number, startY: number, endX: number, endY: number, constrain: boolean) => {
    const ctx = context(layer.current);
    const s = settings.current;
    let [dx, dy] = [endX - startX, endY - startY];

    ctx.clearRect(0, 0, layer.current.width, layer.current.height);
    ctx.fillStyle = ctx.strokeStyle = s.colour;
    ctx.lineWidth = s.size;
    ctx.lineJoin = "miter";

    if (s.shape === "line") {
      if (constrain) {
        // Snap to the nearest eighth of a turn.
        const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const length = Math.hypot(dx, dy);
        [dx, dy] = [Math.cos(angle) * length, Math.sin(angle) * length];
      }

      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(startX + dx, startY + dy);
      ctx.stroke();
      return;
    }

    if (constrain) {
      const side = Math.max(Math.abs(dx), Math.abs(dy));
      [dx, dy] = [Math.sign(dx || 1) * side, Math.sign(dy || 1) * side];
    }

    ctx.beginPath();

    if (s.shape === "rectangle") ctx.rect(startX, startY, dx, dy);
    else ctx.ellipse(startX + dx / 2, startY + dy / 2, Math.abs(dx / 2), Math.abs(dy / 2), 0, 0, Math.PI * 2);

    if (s.filled) ctx.fill();
    else ctx.stroke();
  };

  const pick = (x: number, y: number) => {
    if (!inside(x, y)) return;

    const [r, g, b, a] = pixelAt(snapshot(), Math.floor(x), Math.floor(y));

    // A transparent pixel has no colour worth taking.
    if (a === 0) return;

    setColour(rgbToHex([r, g, b]));
    setOpacity(Math.max(1, Math.round((a / 255) * 100)));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (status.kind !== "ready") return;

    e.currentTarget.setPointerCapture(e.pointerId);

    const s = settings.current;
    const { x, y } = toImage(e);

    if (e.button === 1 || e.button === 2 || s.tool === "hand" || spaceHeld.current) {
      drag.current = { kind: "pan", pointerX: e.clientX, pointerY: e.clientY, cameraX: camera.current.x, cameraY: camera.current.y };
      return;
    }

    if (e.altKey || s.tool === "picker") {
      pick(x, y);
      return;
    }

    switch (s.tool) {
      case "brush":
      case "eraser":
        checkpoint();
        context(layer.current).clearRect(0, 0, layer.current.width, layer.current.height);
        strokeSegment(x, y, x, y);
        drag.current = { kind: "paint", lastX: x, lastY: y };
        if (s.tool === "brush") remember(s.colour);
        break;

      case "shape":
        checkpoint();
        drag.current = { kind: "shape", startX: x, startY: y };
        drawShape(x, y, x, y, e.shiftKey);
        remember(s.colour);
        break;

      case "select":
        drag.current = { kind: "select", startX: x, startY: y, moved: false };
        break;

      case "fill":
        if (inside(x, y)) {
          const [r, g, b] = hexToRgb(s.colour);

          editPixels((pixels, within) => floodFill(pixels, Math.floor(x), Math.floor(y), [r, g, b, Math.round((s.opacity / 100) * 255)], s.tolerance, s.contiguous, within));
          remember(s.colour);
        }
        break;

      case "replace":
        if (inside(x, y)) {
          const from = pixelAt(snapshot(), Math.floor(x), Math.floor(y));

          if (from[3] > 0) {
            editPixels((pixels, within) => replaceColour(pixels, from, hexToRgb(s.colour), s.tolerance, within));
            remember(s.colour);
          }
        }
        break;
    }

    requestPaint();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = toImage(e);
    const active = drag.current;

    pointer.current = { x, y };

    if (active?.kind === "pan") {
      camera.current = { ...camera.current, x: active.cameraX + e.clientX - active.pointerX, y: active.cameraY + e.clientY - active.pointerY };
    } else if (active?.kind === "paint") {
      strokeSegment(active.lastX, active.lastY, x, y);
      active.lastX = x;
      active.lastY = y;
    } else if (active?.kind === "shape") {
      drawShape(active.startX, active.startY, x, y, e.shiftKey);
    } else if (active?.kind === "select") {
      active.moved = true;
      setSelection(regionBetween(active.startX, active.startY, x, y, doc.current.width, doc.current.height));
    }

    // Only say what is under the pointer when that has changed, as this runs for every movement.
    const [px, py] = [Math.floor(x), Math.floor(y)];

    if (!inside(px, py)) setHover((current) => (current ? null : current));
    else if (hover?.x !== px || hover.y !== py) setHover({ x: px, y: py, colour: context(doc.current).getImageData(px, py, 1, 1).data as unknown as Rgba });

    requestPaint();
  };

  const onPointerUp = () => {
    const active = drag.current;
    drag.current = null;

    if (active?.kind === "paint" || active?.kind === "shape") {
      composeLayer(context(doc.current));
      context(layer.current).clearRect(0, 0, layer.current.width, layer.current.height);
    } else if (active?.kind === "select") {
      // A click without a drag lets go of the selection, as does one too small to hold anything.
      setSelection((current) => (active.moved && current && current.width > 0 && current.height > 0 ? current : null));
    }

    requestPaint();
  };

  // The wheel zooms. This is attached by hand, as React's own wheel events can't stop the page from scrolling.
  useEffect(() => {
    const canvas = view.current!;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();

      const bounds = canvas.getBoundingClientRect();
      zoomAt(Math.pow(1.0015, -e.deltaY), e.clientX - bounds.left, e.clientY - bounds.top);
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // ---- saving -------------------------------------------------------------------------------------------------

  const toPng = (canvas: HTMLCanvasElement) =>
    new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The image couldn't be turned into a PNG."))), "image/png"));

  const save = async () => {
    if (status.kind !== "ready" || !dirty) return;

    settleAdjustment();
    setStatus({ kind: "saving" });

    try {
      const edited = await saveEdited(await toPng(doc.current));

      // The standard-resolution version is the same picture at half the size, so it can be made from this one.
      if (standard && alsoStandard) {
        const half = makeCanvas(Math.max(1, Math.round(doc.current.width / 2)), Math.max(1, Math.round(doc.current.height / 2)));
        const ctx = half.getContext("2d")!;

        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(doc.current, 0, 0, half.width, half.height);
        onSave(standard.original, await saveEdited(await toPng(half)));
      }

      lastSaved.current = edited;
      onSave(file.original, edited);
      setDirty(false);
      setStatus({ kind: "ready" });
    } catch (e) {
      setStatus({ kind: "error", message: (e as Error).message });
    }
  };

  const confirmDiscard = () => !dirty || window.confirm("Discard the changes you haven't saved?");

  const close = () => {
    if (confirmDiscard()) onClose();
  };

  const revert = () => {
    if (!window.confirm(`Go back to the original ${file.name}? Every edit made to it is thrown away.`)) return;

    onRevert(file.original);
    if (standard && alsoStandard) onRevert(standard.original);
  };

  // ---- the keyboard -------------------------------------------------------------------------------------------

  const actions = useRef({ undo, redo, save, fit, zoomAt, editPixels, requestPaint });
  actions.current = { undo, redo, save, fit, zoomAt, editPixels, requestPaint };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const a = actions.current;
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
      const command = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (command && key === "s") {
        e.preventDefault();
        void a.save();
        return;
      }

      // Everything else is left alone while something is being typed.
      if (typing && !(e.target instanceof HTMLInputElement && e.target.type === "range")) return;

      if (command && key === "z") {
        e.preventDefault();
        if (e.shiftKey) a.redo();
        else a.undo();
      } else if (command && key === "y") {
        e.preventDefault();
        a.redo();
      } else if (command && key === "a") {
        e.preventDefault();
        setSelection({ x: 0, y: 0, width: doc.current.width, height: doc.current.height });
      } else if (command) {
        return;
      } else if (key === " ") {
        e.preventDefault();
        spaceHeld.current = true;
        a.requestPaint();
      } else if (key === "escape") {
        setSelection(null);
      } else if (key === "delete" || key === "backspace") {
        if (settings.current.selection) a.editPixels((pixels, within) => clear(pixels, within));
      } else if (key === "[") {
        setSize((current) => Math.max(1, current - (current > 10 ? 5 : 1)));
      } else if (key === "]") {
        setSize((current) => Math.min(400, current + (current >= 10 ? 5 : 1)));
      } else if (key === "+" || key === "=") {
        a.zoomAt(1.25);
      } else if (key === "-") {
        a.zoomAt(0.8);
      } else if (key === "0") {
        a.fit();
      } else {
        const chosen = TOOLS.find((t) => t.key.toLowerCase() === key);
        if (chosen) setTool(chosen.id);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") {
        spaceHeld.current = false;
        actions.current.requestPaint();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // ---- the window ---------------------------------------------------------------------------------------------

  const busy = status.kind !== "ready";
  const edited = file.current !== file.original;
  const activeTool = TOOLS.find((t) => t.id === tool)!;
  const usesSize = tool === "brush" || tool === "eraser" || (tool === "shape" && !(filled && shape !== "line"));
  const usesColour = tool !== "eraser" && tool !== "select" && tool !== "hand";
  const scope = selection ? "selection" : "image";

  const slider = (label: string, value: number, min: number, max: number, onChange: (value: number) => void, unit = "") => (
    <label className="editor-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} value={value} style={{ "--filled": `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties} onChange={(e) => onChange(Number(e.target.value))} />
      <output>
        {value}
        {unit}
      </output>
    </label>
  );

  return (
    <FloatingWindow
      title={
        <>
          <strong>Edit {title}</strong>
          <span className="muted">
            {dimensions.width} × {dimensions.height}
            {dirty ? " · unsaved changes" : ""}
          </span>
        </>
      }
      width={1040}
      height={700}
      minWidth={760}
      minHeight={480}
      onClose={close}
    >
      <div className="editor">
        <div className="editor-toolbar">
          <button disabled={busy || undoStack.current.length === 0} title="Undo (Ctrl+Z)" onClick={undo}>
            Undo
          </button>
          <button disabled={busy || redoStack.current.length === 0} title="Redo (Ctrl+Shift+Z)" onClick={redo}>
            Redo
          </button>

          <span className="editor-divider" />

          <button title="Zoom out (-)" onClick={() => zoomAt(0.8)}>
            −
          </button>
          <span className="editor-zoom">{Math.round(zoom * 100)}%</span>
          <button title="Zoom in (+)" onClick={() => zoomAt(1.25)}>
            +
          </button>
          <button title="Show the whole image (0)" onClick={fit}>
            Fit
          </button>

          <span className="spacer" />

          {files.length > 1 && (
            <select
              aria-label="Which image of this element to edit"
              title="This element is made of several images"
              value={fileIndex}
              onChange={(e) => {
                if (confirmDiscard()) setFileIndex(Number(e.target.value));
              }}
            >
              {files.map((f, i) => (
                <option key={f.original} value={i}>
                  {f.name}
                </option>
              ))}
            </select>
          )}

          {edited && (
            <button className="quiet" disabled={busy} title="Throw away every edit made to this image" onClick={revert}>
              Revert to original
            </button>
          )}

          <button className="primary" disabled={busy || !dirty} title="Use this version in the mix (Ctrl+S)" onClick={() => void save()}>
            {status.kind === "saving" ? "Saving…" : "Save"}
          </button>
        </div>

        {recolour && (
          <div className="editor-notice">
            <span className="chip" style={{ background: recolour.colour }} />
            {recolour.mode === "tint"
              ? "This element is recoloured with a tint, which turns everything in it into that one colour. Colours you paint here will come out as shades of it."
              : "This element's hue is being shifted by its recolouring, and that goes for anything you paint here too."}{" "}
            What you see here is the image before recolouring.
          </div>
        )}

        <div className="editor-main">
          <div className="editor-tools" role="toolbar" aria-label="Tools" aria-orientation="vertical">
            {TOOLS.map((t) => (
              <button key={t.id} className={t.id === tool ? "on" : ""} aria-pressed={t.id === tool} aria-label={t.label} title={`${t.label} (${t.key})`} onClick={() => setTool(t.id)}>
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <g fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                    {t.icon}
                  </g>
                </svg>
              </button>
            ))}
          </div>

          <div className={`editor-canvas tool-${spaceHeld.current ? "hand" : tool}`}>
            <canvas
              ref={view}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={() => {
                pointer.current = null;
                setHover(null);
                requestPaint();
              }}
              onContextMenu={(e) => e.preventDefault()}
            />
            {status.kind === "loading" && <div className="editor-message">Loading…</div>}
            {status.kind === "error" && <div className="editor-message error">{status.message}</div>}
          </div>

          <div className="editor-panel">
            <div className="editor-tabs" role="tablist" aria-label="What to change">
              {TABS.map((t) => (
                <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} title={t.hint} onClick={() => setTab(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>

            {tab === "tool" && (
            <section>
              <h3>{activeTool.label}</h3>
              <p className="muted">{activeTool.hint}</p>

              {usesColour && (
                <>
                  <div className="editor-colour">
                    <label className="swatch set" style={{ background: colour }} title="Choose a colour">
                      <input type="color" aria-label="Colour" value={colour} onChange={(e) => setColour(e.target.value)} />
                    </label>
                    <input
                      type="text"
                      aria-label="Colour as a hex code"
                      spellCheck={false}
                      maxLength={7}
                      value={colour}
                      onChange={(e) => {
                        const typed = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
                        setColour(/^#[0-9a-f]{6}$/i.test(typed) ? typed.toLowerCase() : typed);
                      }}
                      onBlur={() => {
                        if (!/^#[0-9a-f]{6}$/i.test(colour)) setColour("#ffffff");
                      }}
                    />
                  </div>

                  {recent.length > 0 && (
                    <div className="editor-recent" aria-label="Colours used recently">
                      {recent.map((used) => (
                        <button key={used} title={used} aria-label={used} style={{ background: used }} onClick={() => setColour(used)} />
                      ))}
                    </div>
                  )}
                </>
              )}

              {(tool === "brush" || tool === "eraser" || tool === "fill" || tool === "shape") && slider(tool === "eraser" ? "Strength" : "Opacity", opacity, 1, 100, setOpacity, "%")}
              {usesSize && slider("Size", size, 1, 200, setSize, "px")}
              {(tool === "fill" || tool === "replace") && slider("Tolerance", tolerance, 0, 100, setTolerance)}

              {tool === "fill" && (
                <label className="editor-check">
                  <input type="checkbox" checked={contiguous} onChange={(e) => setContiguous(e.target.checked)} />
                  Only the area clicked
                </label>
              )}

              {tool === "shape" && (
                <>
                  <div className="segmented" role="group" aria-label="Shape">
                    {(["line", "rectangle", "ellipse"] as const).map((kind) => (
                      <button key={kind} className={shape === kind ? "on" : ""} aria-pressed={shape === kind} onClick={() => setShape(kind)}>
                        {kind[0]!.toUpperCase() + kind.slice(1)}
                      </button>
                    ))}
                  </div>
                  {shape !== "line" && (
                    <label className="editor-check">
                      <input type="checkbox" checked={filled} onChange={(e) => setFilled(e.target.checked)} />
                      Filled in
                    </label>
                  )}
                </>
              )}
            </section>
            )}

            {tab === "tool" && (tool === "select" || selection) && (
            <section>
              <h3>Selection</h3>
              {selection ? (
                <>
                  <p className="muted">
                    {selection.width} × {selection.height} at {selection.x}, {selection.y}. Tools and adjustments only reach inside it.
                  </p>
                  <div className="editor-buttons">
                    <button disabled={busy} title="Make the selected area transparent (Delete)" onClick={() => editPixels((pixels, within) => clear(pixels, within))}>
                      Delete
                    </button>
                    <button disabled={busy} title="Keep only the selected area" onClick={() => cropTo(selection)}>
                      Crop to it
                    </button>
                    <button title="Let go of the selection (Esc)" onClick={() => setSelection(null)}>
                      Deselect
                    </button>
                  </div>
                </>
              ) : (
                <div className="editor-buttons">
                  <button title="Select the whole image (Ctrl+A)" onClick={() => setSelection({ x: 0, y: 0, width: dimensions.width, height: dimensions.height })}>
                    Select all
                  </button>
                </div>
              )}
            </section>
            )}

            {tab === "adjust" && (
            <section>
              <h3>Adjust {scope}</h3>
              {slider("Hue", adjustment.hue, -180, 180, (hue) => tryAdjustment({ ...adjustment, hue }), "°")}
              {slider("Saturation", adjustment.saturation, -100, 100, (saturation) => tryAdjustment({ ...adjustment, saturation }))}
              {slider("Brightness", adjustment.brightness, -100, 100, (brightness) => tryAdjustment({ ...adjustment, brightness }))}
              {slider("Opacity", adjustment.opacity, 0, 100, (value) => tryAdjustment({ ...adjustment, opacity: value }), "%")}

              <div className="editor-buttons">
                {isAdjusted(adjustment) && (
                  <>
                    <button className="on" onClick={settleAdjustment}>
                      Keep
                    </button>
                    <button onClick={cancelAdjustment}>Cancel</button>
                  </>
                )}
                <button disabled={busy} onClick={() => editPixels((pixels, within) => invert(pixels, within))}>
                  Invert
                </button>
                <button disabled={busy} onClick={() => editPixels((pixels, within) => greyscale(pixels, within))}>
                  Greyscale
                </button>
              </div>
            </section>
            )}

            {tab === "image" && (
            <section>
              <h3>Image</h3>
              <div className="editor-buttons">
                <button disabled={busy} onClick={() => flip(true)}>
                  Flip ↔
                </button>
                <button disabled={busy} onClick={() => flip(false)}>
                  Flip ↕
                </button>
                <button disabled={busy} title="Turn a quarter turn left" onClick={() => rotate(false)}>
                  Rotate ⟲
                </button>
                <button disabled={busy} title="Turn a quarter turn right" onClick={() => rotate(true)}>
                  Rotate ⟳
                </button>
                <button disabled={busy} title="Cut away the empty space around the picture" onClick={trim}>
                  Trim edges
                </button>
                <button disabled={busy} title="Make the whole image transparent" onClick={() => editPixels((pixels) => clear(pixels))}>
                  Clear
                </button>
              </div>

              <form
                className="editor-resize"
                onSubmit={(e) => {
                  e.preventDefault();
                  resize();
                }}
              >
                <input type="text" inputMode="numeric" aria-label="Width in pixels" value={resizeTo.width} onChange={(e) => setResize("width", e.target.value)} />
                <span className="muted">×</span>
                <input type="text" inputMode="numeric" aria-label="Height in pixels" value={resizeTo.height} onChange={(e) => setResize("height", e.target.value)} />
                <button type="submit" disabled={busy} title="Stretch or shrink the image to this size. In osu! it will appear that much larger or smaller.">
                  Resize
                </button>
              </form>
            </section>
            )}
          </div>
        </div>

        <div className="editor-status">
          <span>{hover ? `${hover.x}, ${hover.y}` : " "}</span>
          {hover && (
            <span className="editor-status-colour">
              <span className="chip" style={{ background: `rgb(${hover.colour[0]} ${hover.colour[1]} ${hover.colour[2]} / ${hover.colour[3] / 255})` }} />
              {hover.colour[3] === 0 ? "transparent" : `${rgbToHex(hover.colour)} · ${Math.round((hover.colour[3] / 255) * 100)}%`}
            </span>
          )}

          <span className="spacer" />

          {standard && (
            <label className="editor-check" title={`${standard.name} is the same picture at half the size, for screens which don't use the larger one`}>
              <input type="checkbox" checked={alsoStandard} onChange={(e) => setAlsoStandard(e.target.checked)} />
              Update {standard.name} to match
            </label>
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}

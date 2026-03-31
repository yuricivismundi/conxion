const MAX_SOURCE_COVER_SIZE_BYTES = 20 * 1024 * 1024;
export const MAX_UPLOADED_COVER_SIZE_BYTES = 5 * 1024 * 1024;
export const EVENT_COVER_ACCEPT_MIME = ["image/jpeg", "image/jpg", "image/png", "image/webp"] as const;

const EVENT_COVER_OUTPUT_MIME = "image/jpeg";
export const EVENT_COVER_WIDTH = 1600;
export const EVENT_COVER_HEIGHT = 900;
export const EVENT_COVER_ASPECT_RATIO = EVENT_COVER_WIDTH / EVENT_COVER_HEIGHT;
const EVENT_COVER_QUALITY_STEPS = [0.92, 0.86, 0.8] as const;

export type EventCoverCropSettings = {
  zoom: number;
  panX: number;
  panY: number;
};

function baseName(filename: string) {
  const trimmed = filename.trim();
  const name = trimmed.replace(/\.[^.]+$/, "").trim();
  return name || "event-cover";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function loadImageFromFile(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read this image."));
    };
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("Could not prepare this cover image."));
      },
      EVENT_COVER_OUTPUT_MIME,
      quality
    );
  });
}

export function validateEventCoverSourceFile(file: File) {
  const lowerType = file.type.toLowerCase();
  const lowerName = file.name.toLowerCase();
  const hasAcceptedMime = EVENT_COVER_ACCEPT_MIME.includes(lowerType as (typeof EVENT_COVER_ACCEPT_MIME)[number]);
  const hasAcceptedExtension = /\.(jpe?g|png|webp)$/i.test(lowerName);

  if (!hasAcceptedMime && !(hasAcceptedExtension && (!lowerType || lowerType.startsWith("image/")))) {
    throw new Error("Cover must be JPG, PNG, or WEBP.");
  }
  if (file.size > MAX_SOURCE_COVER_SIZE_BYTES) {
    throw new Error("Choose an image under 20MB.");
  }
}

export function getEventCoverRenderLayout(params: {
  sourceWidth: number;
  sourceHeight: number;
  frameWidth: number;
  frameHeight: number;
  crop?: Partial<EventCoverCropSettings>;
}) {
  const { sourceWidth, sourceHeight, frameWidth, frameHeight } = params;
  if (!sourceWidth || !sourceHeight || !frameWidth || !frameHeight) {
    throw new Error("Could not read this image size.");
  }

  const baseScale = Math.max(frameWidth / sourceWidth, frameHeight / sourceHeight);
  const zoom = Math.max(params.crop?.zoom ?? 1, 1);
  const renderWidth = sourceWidth * baseScale * zoom;
  const renderHeight = sourceHeight * baseScale * zoom;

  const maxOffsetX = Math.max((renderWidth - frameWidth) / 2, 0);
  const maxOffsetY = Math.max((renderHeight - frameHeight) / 2, 0);
  const panX = clamp(params.crop?.panX ?? 0, -1, 1);
  const panY = clamp(params.crop?.panY ?? 0, -1, 1);

  return {
    renderWidth,
    renderHeight,
    maxOffsetX,
    maxOffsetY,
    offsetX: panX * maxOffsetX,
    offsetY: panY * maxOffsetY,
  };
}

function drawWideCover(image: HTMLImageElement, crop?: Partial<EventCoverCropSettings>) {
  const canvas = document.createElement("canvas");
  canvas.width = EVENT_COVER_WIDTH;
  canvas.height = EVENT_COVER_HEIGHT;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not prepare this cover image.");
  }

  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const render = getEventCoverRenderLayout({
    sourceWidth,
    sourceHeight,
    frameWidth: EVENT_COVER_WIDTH,
    frameHeight: EVENT_COVER_HEIGHT,
    crop,
  });

  const left = EVENT_COVER_WIDTH / 2 - render.renderWidth / 2 + render.offsetX;
  const top = EVENT_COVER_HEIGHT / 2 - render.renderHeight / 2 + render.offsetY;

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.fillStyle = "#091217";
  context.fillRect(0, 0, EVENT_COVER_WIDTH, EVENT_COVER_HEIGHT);
  context.drawImage(image, left, top, render.renderWidth, render.renderHeight);

  return canvas;
}

export async function prepareEventCoverFile(file: File, crop?: Partial<EventCoverCropSettings>) {
  validateEventCoverSourceFile(file);

  const image = await loadImageFromFile(file);
  const canvas = drawWideCover(image, crop);

  let bestBlob: Blob | null = null;
  for (const quality of EVENT_COVER_QUALITY_STEPS) {
    const blob = await canvasToBlob(canvas, quality);
    if (!bestBlob || blob.size < bestBlob.size) {
      bestBlob = blob;
    }
    if (blob.size <= MAX_UPLOADED_COVER_SIZE_BYTES) {
      bestBlob = blob;
      break;
    }
  }

  if (!bestBlob || bestBlob.size > MAX_UPLOADED_COVER_SIZE_BYTES) {
    throw new Error("Could not fit this image into the event cover format. Try a smaller source image.");
  }

  return new File([bestBlob], `${baseName(file.name)}-cover.jpg`, {
    type: EVENT_COVER_OUTPUT_MIME,
    lastModified: Date.now(),
  });
}

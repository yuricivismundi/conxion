"use client";

import {
  PROFILE_MEDIA_ACCEPTED_PHOTO_MIME_TYPES,
  PROFILE_MEDIA_MAX_PHOTO_INPUT_BYTES,
  PROFILE_MEDIA_TARGET_PHOTO_IDEAL_BYTES,
  PROFILE_MEDIA_TARGET_PHOTO_MAX_BYTES,
} from "@/lib/profile-media/limits";

type LoadedImage = {
  image: HTMLImageElement;
  width: number;
  height: number;
  objectUrl: string;
};

async function loadImage(file: File): Promise<LoadedImage> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new window.Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Could not read image."));
      element.src = objectUrl;
    });

    return {
      image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      objectUrl,
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Could not export image."));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      quality
    );
  });
}

export async function compressProfilePhotoFile(file: File) {
  if (!PROFILE_MEDIA_ACCEPTED_PHOTO_MIME_TYPES.includes(file.type as (typeof PROFILE_MEDIA_ACCEPTED_PHOTO_MIME_TYPES)[number])) {
    throw new Error("Photos must be JPEG, PNG, or WebP.");
  }
  if (file.size > PROFILE_MEDIA_MAX_PHOTO_INPUT_BYTES) {
    throw new Error("Photos must be under 10MB before compression.");
  }

  const loaded = await loadImage(file);
  try {
    const maxDimension = 1600;
    const scale = Math.min(1, maxDimension / Math.max(loaded.width, loaded.height));
    let targetWidth = Math.max(1, Math.round(loaded.width * scale));
    let targetHeight = Math.max(1, Math.round(loaded.height * scale));
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) throw new Error("Could not prepare image compression.");

    let bestBlob: Blob | null = null;
    let bestWidth = targetWidth;
    let bestHeight = targetHeight;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      context.clearRect(0, 0, targetWidth, targetHeight);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, targetWidth, targetHeight);
      context.drawImage(loaded.image, 0, 0, targetWidth, targetHeight);

      const qualities = [0.86, 0.8, 0.74, 0.68, 0.62, 0.56];
      for (const quality of qualities) {
        const blob = await canvasToBlob(canvas, quality);
        bestBlob = blob;
        bestWidth = targetWidth;
        bestHeight = targetHeight;
        if (blob.size <= PROFILE_MEDIA_TARGET_PHOTO_IDEAL_BYTES) {
          return { blob, width: bestWidth, height: bestHeight, contentType: "image/jpeg" as const };
        }
      }

      if (bestBlob && bestBlob.size <= PROFILE_MEDIA_TARGET_PHOTO_MAX_BYTES) {
        return { blob: bestBlob, width: bestWidth, height: bestHeight, contentType: "image/jpeg" as const };
      }

      const nextWidth = Math.round(targetWidth * 0.84);
      const nextHeight = Math.round(targetHeight * 0.84);
      targetWidth = Math.max(240, Math.min(targetWidth, nextWidth));
      targetHeight = Math.max(240, Math.min(targetHeight, nextHeight));
    }

    if (!bestBlob) throw new Error("Could not compress image.");
    return { blob: bestBlob, width: bestWidth, height: bestHeight, contentType: "image/jpeg" as const };
  } finally {
    URL.revokeObjectURL(loaded.objectUrl);
  }
}

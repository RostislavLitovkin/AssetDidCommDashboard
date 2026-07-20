/**
 * Client-side profile-image normalization, mirroring the mobile app
 * (`XcavateProfileService` -> `ImageModel.CompressImageToJpeg`): crop to a
 * centered square, downscale to 256x256, and re-encode as JPEG under a size
 * budget. This keeps uploads small so the API (and any reverse proxy) never
 * rejects them with 413, and gives every avatar a consistent square shape.
 *
 * Browser-only (uses `createImageBitmap` + `<canvas>`); call it from the UI
 * layer, not from SSR code.
 */
export async function resizeProfileImage(
  file: File,
  address: string,
  size = 256,
  maxBytes = 256 * 1024
): Promise<File> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
  } catch {
    throw new Error("Could not read the selected image. Please choose a different file.")
  }

  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext("2d")
  if (!context) {
    bitmap.close?.()
    throw new Error("Image resizing is not supported in this browser.")
  }

  // Center-crop to a square before scaling so the avatar is never distorted.
  const side = Math.min(bitmap.width, bitmap.height)
  const sx = (bitmap.width - side) / 2
  const sy = (bitmap.height - side) / 2
  context.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size)
  bitmap.close?.()

  let blob = await encodeJpeg(canvas, 0.9)
  for (const quality of [0.8, 0.7, 0.6, 0.5]) {
    if (blob.size <= maxBytes) break
    blob = await encodeJpeg(canvas, quality)
  }

  return new File([blob], `ProfilePicture_${address}.jpg`, { type: "image/jpeg" })
}

function encodeJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Failed to encode the image."))),
      "image/jpeg",
      quality
    )
  })
}

interface ImageOptions {
  maxWidth: number;
  maxHeight: number;
  maxDataUrlLength: number;
  cropSquare?: boolean;
}

const MAX_SOURCE_BYTES = 12 * 1024 * 1024;

export async function prepareImage(file: File, options: ImageOptions): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("Choose an image smaller than 12 MB");

  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not process the image");

    let sourceX = 0;
    let sourceY = 0;
    let sourceWidth = bitmap.width;
    let sourceHeight = bitmap.height;

    if (options.cropSquare) {
      const sourceSize = Math.min(bitmap.width, bitmap.height);
      sourceX = Math.floor((bitmap.width - sourceSize) / 2);
      sourceY = Math.floor((bitmap.height - sourceSize) / 2);
      sourceWidth = sourceSize;
      sourceHeight = sourceSize;
    }

    const scale = Math.min(1, options.maxWidth / sourceWidth, options.maxHeight / sourceHeight);
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    context.fillStyle = "#111020";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
      bitmap,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    for (const quality of [0.84, 0.76, 0.68, 0.6, 0.52]) {
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      if (dataUrl.length <= options.maxDataUrlLength) return dataUrl;
    }
    throw new Error("The processed image is still too large. Choose a simpler or smaller image");
  } finally {
    bitmap.close();
  }
}

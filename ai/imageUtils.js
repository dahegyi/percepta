/**
 * Handles base64↔blob conversions and image bitmap creation
 */

/**
 * Convert base64 string to Blob
 */
export function base64ToBlob(base64, type) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], { type });
}

/**
 * Convert Blob to base64 string
 * Efficiently handles large blobs by chunking
 */
export async function blobToBase64(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  // Convert to base64 efficiently (avoid spread operator for large arrays)
  let binaryString = "";
  const chunkSize = 8192;
  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    const chunk = uint8Array.slice(i, i + chunkSize);
    binaryString += String.fromCharCode.apply(null, chunk);
  }

  return btoa(binaryString);
}

/**
 * Create ImageBitmap from Blob
 */
export async function createImageBitmapFromBlob(blob) {
  return await createImageBitmap(blob);
}

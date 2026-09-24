// Phones get the native share sheet (Files, Drive, messaging…); elsewhere the file downloads.
export async function shareKmz(kmz: Blob, mapName: string): Promise<void> {
  const file = new File([kmz], `${mapName.replace(/[^\p{L}\p{N}._-]+/gu, '_')}.kmz`, {
    type: 'application/vnd.google-earth.kmz',
  });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: mapName, text: shareMessage(mapName) });
      return;
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return; // user closed the sheet
      // NotAllowedError etc.: fall back to a download
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export function appUrl(): string {
  return __APP_URL__ || new URL('./', location.href).href;
}

// Sent along with the file, so the recipient knows what it is and where to open it.
export function shareMessage(mapName: string): string {
  return `"${mapName}" is a map for Custom Maps. To use it as a live GPS map, open the app, tap "Open file" and choose the attached .kmz:\n${appUrl()}`;
}

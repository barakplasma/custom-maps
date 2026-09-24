// A picked File is only a reference: on Android, access to gallery/cloud files can be revoked
// minutes later, and reading it then fails with NotReadableError ("The requested file could not
// be read…"). Copy the bytes into memory as soon as the file is picked.
export async function readNow(file: File): Promise<Blob> {
  return new Blob([await file.arrayBuffer()], { type: file.type });
}

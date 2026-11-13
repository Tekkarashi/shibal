// Browser preview: there is no on-device text recognition, so flyers are never read.
export async function readImageText(_uri: string): Promise<string | null> {
  return null;
}

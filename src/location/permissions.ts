// True when the user has already allowed location for this site, so reading it
// will not show a permission prompt.
export async function geolocationAlreadyGranted(): Promise<boolean> {
  const status = await navigator.permissions.query({ name: 'geolocation' });
  return status.state === 'granted';
}

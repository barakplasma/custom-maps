import L from 'leaflet';
import { writeKmz } from '../../io/KmzWriter';
import { mapStore } from '../../storage/MapStore';
import type { Tiepoint } from '../../core/Tiepoint';
import { ImagePointPicker } from './ImagePointPicker';
import { showToast } from '../toast';
import { readNow } from '../../io/readNow';
import { LocateControl } from '../LocateControl';
import { geolocationAlreadyGranted } from '../../location/LocationTracker';
import { getEditorView, setEditorView } from '../../storage/Prefs';
import type WaButton from '@awesome.me/webawesome/dist/components/button/button.js';

const MAX_TIEPOINTS = 2;

export class MapEditor {
  constructor(private onDone: () => void) {}

  mount(container: HTMLElement): void {
    this.renderStepA(container);
  }

  // Step A: pick image file
  private renderStepA(container: HTMLElement): void {
    container.innerHTML = `
      <div id="cm-editor" class="app-screen">
        ${appBar('New map', 'Step 1 of 3 · Choose an image')}
        <main class="app-content wa-stack wa-gap-l wa-justify-content-center">
          <input type="file" id="cm-img-input" accept="image/jpeg,image/png,image/gif,image/webp" hidden>
          <wa-card>
           <div class="wa-stack wa-gap-s wa-align-items-center wa-text-center">
            <wa-icon name="image-plus" class="wa-font-size-4xl wa-color-text-quiet"></wa-icon>
            <h2 class="wa-heading-m">Pick a map image</h2>
            <p class="wa-body-s wa-color-text-quiet">A trail map, campus map, or photo of a paper map. JPEG, PNG, GIF or WebP.</p>
            <wa-button id="cm-pick-img" variant="brand" size="l">Choose image…</wa-button>
           </div>
          </wa-card>
        </main>
      </div>`;

    document.getElementById('cm-ed-back')!.addEventListener('click', this.onDone);
    document.getElementById('cm-pick-img')!.addEventListener('click', () => {
      (document.getElementById('cm-img-input') as HTMLInputElement).click();
    });
    document.getElementById('cm-img-input')!.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const blob = await readNow(file);
        const img = await loadImage(blob);
        this.renderStepB(container, img, blob, file.name);
      } catch (err) {
        showToast(`Could not read that image: ${(err as Error).message}`);
      }
    });
  }

  // Step B: place tiepoints. The image picker and the map are created once and kept
  // across tiepoints, so both stay exactly where the user left them.
  private renderStepB(
    container: HTMLElement,
    image: HTMLImageElement,
    imageBlob: Blob,
    imageFilename: string,
  ): void {
    const tiepoints: Tiepoint[] = [];
    let pendingPixel: { x: number; y: number } | null = null;
    let pendingGeo: { lat: number; lon: number } | null = null;
    let geoMarker: L.Marker | null = null;

    container.innerHTML = `
      <div id="cm-editor" class="app-screen">
        ${appBar('New map', stepTwoSubtitle(0))}
        <div class="editor-split">
          <div class="editor-image"><canvas id="cm-canvas"></canvas></div>
          <div class="editor-map"><div id="cm-leaflet"></div></div>
        </div>
        <footer class="action-bar wa-flank:end wa-gap-s wa-align-items-center">
          <span class="wa-body-s" id="cm-status">${statusText(0, null, null)}</span>
          <wa-button id="cm-confirm" variant="brand" disabled>
            <wa-icon slot="start" name="check"></wa-icon> Confirm
          </wa-button>
        </footer>
      </div>`;

    // Image picker
    const canvas = container.querySelector<HTMLCanvasElement>('#cm-canvas')!;
    const picker = new ImagePointPicker(canvas, image);

    // Map picker
    const leafletMap = L.map(container.querySelector<HTMLElement>('#cm-leaflet')!, { zoomControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(leafletMap);
    const locate = new LocateControl().addTo(leafletMap);
    void setInitialView(leafletMap, locate);
    leafletMap.on('moveend', () => {
      const c = leafletMap.getCenter();
      setEditorView({ lat: c.lat, lon: c.lng, zoom: leafletMap.getZoom() });
    });

    const cleanup = () => {
      picker.destroy();
      leafletMap.remove();
    };

    const refresh = () => {
      const n = tiepoints.length;
      container.querySelector('#cm-subtitle')!.textContent = stepTwoSubtitle(n);
      container.querySelector('#cm-status')!.textContent = statusText(n, pendingPixel, pendingGeo);
      container.querySelector<WaButton>('#cm-confirm')!.disabled = !(pendingPixel && pendingGeo);
    };

    container.querySelector('#cm-ed-back')!.addEventListener('click', () => {
      cleanup();
      this.renderStepA(container);
    });

    picker.onPick((x, y) => {
      pendingPixel = { x, y };
      picker.setPending(x, y);
      refresh();
    });

    leafletMap.on('click', (e: L.LeafletMouseEvent) => {
      pendingGeo = { lat: e.latlng.lat, lon: e.latlng.lng };
      if (geoMarker) geoMarker.setLatLng(e.latlng);
      else geoMarker = L.marker(e.latlng).addTo(leafletMap);
      refresh();
    });

    container.querySelector('#cm-confirm')!.addEventListener('click', () => {
      if (!pendingPixel || !pendingGeo) return;
      tiepoints.push({ xPixel: pendingPixel.x, yPixel: pendingPixel.y, lat: pendingGeo.lat, lon: pendingGeo.lon });
      picker.confirmPending();
      // Keep confirmed points visible on the map, distinct from the one being placed
      geoMarker?.remove();
      geoMarker = null;
      L.circleMarker([pendingGeo.lat, pendingGeo.lon], {
        radius: 9, color: '#ffffff', weight: 2, fillColor: '#16a34a', fillOpacity: 1,
      }).addTo(leafletMap);
      pendingPixel = null;
      pendingGeo = null;

      if (tiepoints.length >= MAX_TIEPOINTS) {
        cleanup();
        this.renderSaveStep(container, image, imageBlob, imageFilename, tiepoints);
      } else {
        refresh();
      }
    });
  }

  // Step C: name and save
  private renderSaveStep(
    container: HTMLElement,
    image: HTMLImageElement,
    imageBlob: Blob,
    imageFilename: string,
    tiepoints: Tiepoint[],
  ): void {
    const defaultName = imageFilename.replace(/\.[^.]+$/, '');
    container.innerHTML = `
      <div id="cm-editor" class="app-screen">
        ${appBar('New map', 'Step 3 of 3 · Name and save')}
        <main class="app-content wa-stack wa-gap-l">
          <wa-callout variant="success">
            <wa-icon slot="icon" name="check"></wa-icon>
            ${tiepoints.length} tiepoints set. Your map is ready.
          </wa-callout>
          <wa-input id="cm-map-name" label="Map name" value="${escapeAttr(defaultName)}" placeholder="My map" autocomplete="off" size="l"></wa-input>
          <wa-button id="cm-save" variant="brand" size="l">
            <wa-icon slot="start" name="check"></wa-icon> Save map
          </wa-button>
          <p class="wa-body-s wa-color-text-quiet">Saves to this device, then lets you share or keep a .kmz copy.</p>
        </main>
      </div>`;

    container.querySelector('#cm-ed-back')!.addEventListener('click', () => this.renderStepA(container));
    const nameEl = container.querySelector('wa-input')!;
    container.querySelector('#cm-save')!.addEventListener('click', async () => {
      const name = (nameEl.value ?? '').trim() || defaultName || 'My map';
      await this.save(container, image, imageBlob, imageFilename, name, tiepoints);
    });
    // wa-input can only take focus once it has rendered its inner <input>
    void nameEl.updateComplete.then(() => nameEl.focus());
  }

  private async save(
    container: HTMLElement,
    image: HTMLImageElement,
    imageBlob: Blob,
    imageFilename: string,
    name: string,
    tiepoints: Tiepoint[],
  ): Promise<void> {
    const safeFilename = imageFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const saveBtn = container.querySelector<WaButton>('#cm-save');
    if (saveBtn) saveBtn.loading = true;

    try {
      const kmzBlob = await writeKmz({
        name,
        imageBlob,
        imageFilename: safeFilename,
        imageWidth: image.naturalWidth,
        imageHeight: image.naturalHeight,
        tiepoints,
      });

      await mapStore.put({ id: crypto.randomUUID(), name, kmzBlob, createdAt: Date.now() });
      const file = new File([kmzBlob], `${name.replace(/[^a-zA-Z0-9._-]/g, '_')}.kmz`, {
        type: 'application/vnd.google-earth.kmz',
      });
      await shareOrDownload(file);

      this.onDone();
    } catch (err) {
      console.error('Save failed', err);
      if (saveBtn) saveBtn.loading = false;
      showToast(`Save failed: ${(err as Error).message}`);
    }
  }
}

function appBar(title: string, subtitle: string): string {
  return `
    <header class="app-bar wa-cluster wa-gap-s wa-align-items-center">
      <wa-button id="cm-ed-back" appearance="plain" size="l">
        <wa-icon name="arrow-left" label="Back"></wa-icon>
      </wa-button>
      <div class="wa-stack wa-gap-3xs">
        <h1 class="wa-heading-s">${title}</h1>
        <span id="cm-subtitle" class="wa-caption-m wa-color-text-quiet">${subtitle}</span>
      </div>
    </header>`;
}

function stepTwoSubtitle(n: number): string {
  return `Step 2 of 3 · Tiepoint ${n + 1} of ${MAX_TIEPOINTS}`;
}

// Where the map picker starts: the user's current location if they have already allowed it
// (no prompt is shown), otherwise the last place they looked, otherwise the whole world.
async function setInitialView(map: L.Map, locate: LocateControl): Promise<void> {
  const saved = getEditorView();
  if (saved) map.setView([saved.lat, saved.lon], saved.zoom);
  else map.setView([20, 0], 2);
  // Don't pull the map away if the user already started panning or zooming it themselves
  let userMoved = false;
  map.once('dragstart zoomstart', () => { userMoved = true; });
  if (await geolocationAlreadyGranted() && !userMoved) await locate.locate(map);
}

// Phones get the native share sheet (Files, Drive, messaging…); elsewhere the file downloads.
async function shareOrDownload(file: File): Promise<void> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
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

function escapeAttr(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function statusText(
  n: number,
  pixel: { x: number; y: number } | null,
  geo: { lat: number; lon: number } | null,
): string {
  if (n >= MAX_TIEPOINTS) return `${n} tiepoints ready.`;
  if (!pixel && !geo) return 'Tap a spot on the image you can also find on the map.';
  if (pixel && !geo)  return 'Now tap the same spot on the map below.';
  if (!pixel && geo)  return 'Got map point. Tap image to match it.';
  return 'Both points picked. Tap Confirm.';
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not load image')); };
    img.src = url;
  });
}

import L from 'leaflet';
import { writeKmz } from '../../io/KmzWriter';
import { mapStore } from '../../storage/MapStore';
import type { Tiepoint } from '../../core/Tiepoint';
import { ImagePointPicker } from './ImagePointPicker';

const MAX_TIEPOINTS = 2;

export class MapEditor {
  constructor(private onDone: () => void) {}

  mount(container: HTMLElement): void {
    this.renderStepA(container);
  }

  // Step A: pick image file
  private renderStepA(container: HTMLElement): void {
    container.innerHTML = `
      <style>
        #cm-editor { min-height: 100dvh; display: flex; flex-direction: column; }
        #cm-editor nav { flex-shrink: 0; }
        #cm-editor .step-body { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem; padding: 1rem; }
        #cm-editor input[type=file] { display: none; }
      </style>
      <div id="cm-editor">
        <nav>
          <ul><li><button id="cm-ed-back" class="outline">← Back</button></li></ul>
          <ul><li><strong>Create Map — Step 1</strong></li></ul>
        </nav>
        <div class="step-body container">
          <p>Select a map image (JPEG or PNG).</p>
          <input type="file" id="cm-img-input" accept="image/jpeg,image/png,image/gif">
          <button id="cm-pick-img">Choose image…</button>
        </div>
      </div>`;

    document.getElementById('cm-ed-back')!.addEventListener('click', this.onDone);
    document.getElementById('cm-pick-img')!.addEventListener('click', () => {
      (document.getElementById('cm-img-input') as HTMLInputElement).click();
    });
    document.getElementById('cm-img-input')!.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const blob = file;
      const filename = file.name;
      const img = await loadImage(blob);
      this.renderStepB(container, img, blob, filename);
    });
  }

  // Step B: place tiepoints
  private renderStepB(
    container: HTMLElement,
    image: HTMLImageElement,
    imageBlob: Blob,
    imageFilename: string,
  ): void {
    const tiepoints: Tiepoint[] = [];
    let pendingPixel: { x: number; y: number } | null = null;
    let pendingGeo: { lat: number; lon: number } | null = null;
    let leafletMap: L.Map | null = null;
    let picker: ImagePointPicker | null = null;
    let geoMarker: L.Marker | null = null;

    const render = () => {
      const n = tiepoints.length;
      const canConfirm = pendingPixel !== null && pendingGeo !== null;
      const canSave   = n >= MAX_TIEPOINTS;

      container.innerHTML = `
        <style>
          #cm-editor { height: 100dvh; display: flex; flex-direction: column; overflow: hidden; }
          #cm-editor nav { flex-shrink: 0; }
          #cm-editor .split { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
          #cm-editor .split .img-half { flex: 1; position: relative; overflow: hidden; background: #111; }
          #cm-editor .split .img-half canvas { width: 100%; height: 100%; display: block; }
          #cm-editor .split .map-half { flex: 1; position: relative; }
          #cm-editor .split .map-half > div { position: absolute; inset: 0; }
          #cm-editor .controls { flex-shrink: 0; padding: .5rem 1rem; display: flex; gap: .5rem; align-items: center; background: var(--pico-background-color, #fff); border-top: 1px solid var(--pico-muted-border-color, #ddd); }
          #cm-editor .status { flex: 1; font-size: .85rem; }
          #cm-editor input[type=file] { display: none; }
        </style>
        <div id="cm-editor">
          <nav>
            <ul><li><button id="cm-ed-back" class="outline">← Back</button></li></ul>
            <ul><li><strong>Tiepoints: ${n}/${MAX_TIEPOINTS}</strong></li></ul>
          </nav>
          <div class="split">
            <div class="img-half"><canvas id="cm-canvas"></canvas></div>
            <div class="map-half"><div id="cm-leaflet"></div></div>
          </div>
          <div class="controls">
            <span class="status" id="cm-status">${statusText(n, pendingPixel, pendingGeo)}</span>
            <button id="cm-confirm" ${canConfirm?'':'disabled'}>Confirm pair</button>
            <button id="cm-save" ${canSave?'':'disabled'}>Save</button>
          </div>
        </div>`;

      document.getElementById('cm-ed-back')!.addEventListener('click', () => {
        leafletMap?.remove();
        this.renderStepA(container);
      });

      // Image picker
      const canvas = document.getElementById('cm-canvas') as HTMLCanvasElement;
      picker = new ImagePointPicker(canvas, image);
      // Re-add confirmed picks
      for (const tp of tiepoints) picker.addMark(tp.xPixel, tp.yPixel);

      picker.onPick((x, y) => {
        pendingPixel = { x, y };
        picker!.addMark(x, y);
        updateStatus();
        updateButtons();
      });

      // Leaflet map
      const mapDiv = document.getElementById('cm-leaflet')!;
      leafletMap = L.map(mapDiv, { zoomControl: true }).setView([20, 0], 2);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(leafletMap);

      leafletMap.on('click', (e: L.LeafletMouseEvent) => {
        pendingGeo = { lat: e.latlng.lat, lon: e.latlng.lng };
        if (geoMarker) geoMarker.setLatLng(e.latlng);
        else geoMarker = L.marker(e.latlng).addTo(leafletMap!);
        updateStatus();
        updateButtons();
      });

      document.getElementById('cm-confirm')!.addEventListener('click', () => {
        if (!pendingPixel || !pendingGeo) return;
        tiepoints.push({ xPixel: pendingPixel.x, yPixel: pendingPixel.y, lat: pendingGeo.lat, lon: pendingGeo.lon });
        pendingPixel = null;
        pendingGeo = null;
        geoMarker?.remove();
        geoMarker = null;
        leafletMap?.remove();
        render(); // re-render with updated count
      });

      document.getElementById('cm-save')!.addEventListener('click', async () => {
        leafletMap?.remove();
        await this.save(container, image, imageBlob, imageFilename, tiepoints);
      });
    };

    const updateStatus = () => {
      const el = document.getElementById('cm-status');
      if (el) el.textContent = statusText(tiepoints.length, pendingPixel, pendingGeo);
    };
    const updateButtons = () => {
      const confirm = document.getElementById('cm-confirm') as HTMLButtonElement|null;
      const save    = document.getElementById('cm-save')    as HTMLButtonElement|null;
      if (confirm) confirm.disabled = !(pendingPixel && pendingGeo);
      if (save)    save.disabled    = tiepoints.length < MAX_TIEPOINTS;
    };

    render();
  }

  private async save(
    _container: HTMLElement,
    image: HTMLImageElement,
    imageBlob: Blob,
    imageFilename: string,
    tiepoints: Tiepoint[],
  ): Promise<void> {
    const name = prompt('Map name:', imageFilename.replace(/\.[^.]+$/, '')) ?? 'My map';
    const safeFilename = imageFilename.replace(/[^a-zA-Z0-9._-]/g, '_');

    try {
      const kmzBlob = await writeKmz({
        name,
        imageBlob,
        imageFilename: safeFilename,
        imageWidth: image.naturalWidth,
        imageHeight: image.naturalHeight,
        tiepoints,
      });

      // Trigger download
      const a = document.createElement('a');
      a.href = URL.createObjectURL(kmzBlob);
      a.download = `${name.replace(/[^a-zA-Z0-9._-]/g,'_')}.kmz`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);

      // Save to library
      await mapStore.put({ id: crypto.randomUUID(), name, kmzBlob, createdAt: Date.now() });

      this.onDone();
    } catch (err) {
      alert(`Failed to save: ${(err as Error).message}`);
    }
  }
}

function statusText(
  n: number,
  pixel: { x: number; y: number } | null,
  geo: { lat: number; lon: number } | null,
): string {
  if (n >= MAX_TIEPOINTS) return `${n} tiepoints ready. Click Save.`;
  if (!pixel && !geo) return `Tap on the image to pick point ${n+1}.`;
  if (pixel && !geo)  return 'Now click the same spot on the map.';
  if (!pixel && geo)  return 'Got map point. Tap image to match it.';
  return 'Both picked. Tap Confirm.';
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

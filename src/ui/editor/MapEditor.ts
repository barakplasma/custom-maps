import L from 'leaflet';
import { writeKmz } from '../../io/KmzWriter';
import { mapStore } from '../../storage/MapStore';
import type { Tiepoint } from '../../core/Tiepoint';
import { ImagePointPicker } from './ImagePointPicker';
import { showToast } from '../toast';
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
          <input type="file" id="cm-img-input" class="hidden-input" accept="image/jpeg,image/png,image/gif,image/webp">
          <div class="dropzone wa-stack wa-gap-s wa-align-items-center wa-text-center">
            <wa-icon name="image-plus"></wa-icon>
            <h2 class="wa-heading-m">Pick a map image</h2>
            <p class="wa-body-s wa-color-text-quiet">A trail map, campus map, or photo of a paper map. JPEG, PNG, GIF or WebP.</p>
            <wa-button id="cm-pick-img" variant="brand" size="l">Choose image…</wa-button>
          </div>
        </main>
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

    const defaultName = imageFilename.replace(/\.[^.]+$/, '');

    const render = () => {
      const n = tiepoints.length;
      const canConfirm = pendingPixel !== null && pendingGeo !== null;
      const canSave   = n >= MAX_TIEPOINTS;

      if (canSave) {
        // Save-ready screen: clean up picker and Leaflet map
        picker?.destroy();
        picker = null;
        leafletMap?.remove();
        leafletMap = null;
        container.innerHTML = `
          <div id="cm-editor" class="app-screen">
            ${appBar('New map', 'Step 3 of 3 · Name and save')}
            <main class="app-content">
              <div class="form-column wa-stack wa-gap-l save-body">
                <wa-callout variant="success">
                  <wa-icon slot="icon" name="check"></wa-icon>
                  ${n} tiepoints set. Your map is ready.
                </wa-callout>
                <wa-input id="cm-map-name" label="Map name" value="${escapeAttr(defaultName)}" placeholder="My map" autocomplete="off" size="l"></wa-input>
                <wa-button id="cm-save" variant="brand" size="l">
                  <wa-icon slot="start" name="check"></wa-icon> Save map
                </wa-button>
                <p class="wa-body-s wa-color-text-quiet">Saves to this device and downloads a .kmz copy you can share.</p>
              </div>
            </main>
          </div>`;

        document.getElementById('cm-ed-back')!.addEventListener('click', () => this.renderStepA(container));
        const nameEl = container.querySelector('wa-input')!;
        document.getElementById('cm-save')!.addEventListener('click', async () => {
          const name = (nameEl.value ?? '').trim() || defaultName || 'My map';
          await this.save(container, image, imageBlob, imageFilename, name, tiepoints);
        });
        // wa-input can only take focus once it has rendered its inner <input>
        void nameEl.updateComplete.then(() => nameEl.focus());
        return;
      }

      container.innerHTML = `
        <div id="cm-editor" class="app-screen">
          ${appBar('New map', `Step 2 of 3 · Tiepoint ${n + 1} of ${MAX_TIEPOINTS}`)}
          <div class="editor-split">
            <div class="editor-image"><canvas id="cm-canvas"></canvas></div>
            <div class="editor-map"><div id="cm-leaflet"></div></div>
          </div>
          <footer class="action-bar wa-cluster wa-gap-s wa-align-items-center">
            <span class="editor-status wa-body-s" id="cm-status">${statusText(n, pendingPixel, pendingGeo)}</span>
            <wa-button id="cm-confirm" variant="brand" ${canConfirm ? '' : 'disabled'}>
              <wa-icon slot="start" name="check"></wa-icon> Confirm
            </wa-button>
          </footer>
        </div>`;

      document.getElementById('cm-ed-back')!.addEventListener('click', () => {
        leafletMap?.remove();
        this.renderStepA(container);
      });

      // Image picker
      const canvas = document.getElementById('cm-canvas') as HTMLCanvasElement;
      picker = new ImagePointPicker(canvas, image);
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
        leafletMap = null;
        render();
      });
    };

    const updateStatus = () => {
      const el = document.getElementById('cm-status');
      if (el) el.textContent = statusText(tiepoints.length, pendingPixel, pendingGeo);
    };
    const updateButtons = () => {
      const confirm = container.querySelector<WaButton>('#cm-confirm');
      if (confirm) confirm.disabled = !(pendingPixel && pendingGeo);
    };

    render();
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

      // Trigger download — must be in DOM for Firefox
      const a = document.createElement('a');
      a.href = URL.createObjectURL(kmzBlob);
      a.download = `${name.replace(/[^a-zA-Z0-9._-]/g,'_')}.kmz`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);

      // Save to library
      await mapStore.put({ id: crypto.randomUUID(), name, kmzBlob, createdAt: Date.now() });

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
        <span class="wa-caption-m wa-color-text-quiet">${subtitle}</span>
      </div>
    </header>`;
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

import { readKmz } from '../io/KmzReader';
import { mapStore } from '../storage/MapStore';
import type { GroundOverlay } from '../core/GroundOverlay';
import { MapView } from './MapView';
import { MapEditor } from './editor/MapEditor';
import { showToast } from './toast';

export class MapLibrary {
  constructor(private root: HTMLElement) {}

  mount(): void {
    this.render();
  }

  private async render(): Promise<void> {
    const maps = await mapStore.list();
    maps.sort((a, b) => b.createdAt - a.createdAt);

    this.root.innerHTML = `
      <div id="cm-library" class="app-screen">
        <header class="app-bar">
          <h1 class="wa-heading-l wa-cluster wa-gap-xs wa-align-items-center">
            <wa-icon name="map"></wa-icon> Custom Maps
          </h1>
        </header>
        <main class="app-content">
          <input type="file" id="cm-file-input" class="hidden-input" accept=".kmz">
          ${maps.length === 0
            ? `<div class="empty-state wa-stack wa-gap-s wa-align-items-center wa-text-center">
                 <wa-icon name="map-pin"></wa-icon>
                 <h2 class="wa-heading-m">No maps yet</h2>
                 <p class="wa-body-m wa-color-text-quiet">Open a .kmz file, or turn any map image into a GPS map.</p>
               </div>`
            : `<ul class="map-list">
                ${maps.map(m => `
                  <li class="wa-cluster wa-gap-2xs wa-align-items-center">
                    <wa-button class="open" appearance="plain" size="l" data-id="${m.id}">
                      <wa-icon slot="start" name="map"></wa-icon>
                      ${escapeHtml(m.name)}
                      <wa-icon slot="end" name="chevron-right"></wa-icon>
                    </wa-button>
                    <wa-button class="del" appearance="plain" variant="danger" size="l" data-del="${m.id}" data-name="${escapeHtml(m.name)}">
                      <wa-icon name="trash-2" label="Delete ${escapeHtml(m.name)}"></wa-icon>
                    </wa-button>
                  </li>`).join('')}
               </ul>`
          }
        </main>
        <footer class="action-bar even wa-cluster wa-gap-s">
          <wa-button id="cm-import" appearance="outlined">
            <wa-icon slot="start" name="folder-open"></wa-icon> Open file
          </wa-button>
          <wa-button id="cm-create" variant="brand">
            <wa-icon slot="start" name="plus"></wa-icon> Create map
          </wa-button>
        </footer>
        <wa-dialog id="cm-delete-dialog" label="Delete map?" light-dismiss>
          <p class="wa-body-m" id="cm-delete-text"></p>
          <div slot="footer" class="wa-cluster wa-gap-s wa-justify-content-end">
            <wa-button appearance="outlined" data-dialog="close">Cancel</wa-button>
            <wa-button id="cm-delete-confirm" variant="danger">
              <wa-icon slot="start" name="trash-2"></wa-icon> Delete
            </wa-button>
          </div>
        </wa-dialog>
      </div>
    `;

    document.getElementById('cm-import')!.addEventListener('click', () => {
      (document.getElementById('cm-file-input') as HTMLInputElement).click();
    });

    document.getElementById('cm-file-input')!.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      await this.importKmz(file, file.name.replace(/\.kmz$/i, ''));
    });

    document.getElementById('cm-create')!.addEventListener('click', () => {
      const editor = new MapEditor(() => this.render());
      editor.mount(this.root);
    });

    this.root.querySelectorAll<HTMLElement>('wa-button.open').forEach(btn => {
      btn.addEventListener('click', async () => {
        const rec = await mapStore.get(btn.dataset.id!);
        if (!rec) return;
        try {
          const overlay = await readKmz(rec.kmzBlob);
          this.openMap(overlay);
        } catch (err) {
          showToast(`Could not open map: ${(err as Error).message}`);
        }
      });
    });

    // Delete asks for confirmation in a dialog
    const dialog = this.root.querySelector('wa-dialog')!;
    let pendingDelete: string | null = null;
    this.root.querySelectorAll<HTMLElement>('wa-button.del').forEach(btn => {
      btn.addEventListener('click', () => {
        pendingDelete = btn.dataset.del!;
        document.getElementById('cm-delete-text')!.textContent =
          `"${btn.dataset.name}" will be removed from this device. Exported .kmz files are not affected.`;
        dialog.open = true;
      });
    });
    document.getElementById('cm-delete-confirm')!.addEventListener('click', async () => {
      if (!pendingDelete) return;
      await mapStore.delete(pendingDelete);
      dialog.open = false;
      await this.render();
    });
  }

  private async importKmz(blob: Blob, name: string): Promise<void> {
    try {
      const overlay = await readKmz(blob);
      await mapStore.put({ id: crypto.randomUUID(), name: overlay.name || name, kmzBlob: blob, createdAt: Date.now() });
      await this.render();
      this.openMap(overlay);
    } catch (err) {
      showToast(`Failed to open KMZ: ${(err as Error).message}`);
    }
  }

  private openMap(overlay: GroundOverlay): void {
    const view = new MapView(overlay, () => this.render());
    view.mount(this.root);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

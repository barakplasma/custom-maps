import { readKmz } from '../io/KmzReader';
import { mapStore } from '../storage/MapStore';
import type { GroundOverlay } from '../core/GroundOverlay';
import { MapView } from './MapView';
import { MapEditor } from './editor/MapEditor';
import { showToast } from './toast';
import { readNow } from '../io/readNow';
import { appUrl, shareKmz } from './share';
import { isSharedId, publishKmz, sharedKmzUrl, sharingEnabled } from '../io/publish';

export class MapLibrary {
  constructor(private root: HTMLElement) {}

  mount(): void {
    // Short links (/m/<id>) arrive as /?m=<id> (vercel.json redirect)
    const shared = new URLSearchParams(location.search).get('m');
    if (shared) history.replaceState(null, '', location.pathname);
    if (shared && sharingEnabled && isSharedId(shared)) void this.openShared(shared);
    else this.render();
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
          <input type="file" id="cm-file-input" accept=".kmz" hidden>
          ${maps.length === 0
            ? `<div class="wa-stack wa-gap-s wa-align-items-center wa-text-center">
                 <wa-icon name="map-pin" class="wa-font-size-4xl wa-color-text-quiet"></wa-icon>
                 <h2 class="wa-heading-m">No maps yet</h2>
                 <p class="wa-body-m wa-color-text-quiet">Open a .kmz file, or turn any map image into a GPS map.</p>
               </div>`
            : `<ul class="map-list wa-list-plain">
                ${maps.map(m => `
                  <li class="wa-flank:end wa-gap-2xs wa-align-items-center">
                    <wa-button class="open" appearance="plain" size="l" data-id="${m.id}">
                      <wa-icon slot="start" name="map"></wa-icon>
                      ${escapeHtml(m.name)}
                      <wa-icon slot="end" name="chevron-right"></wa-icon>
                    </wa-button>
                    <wa-dropdown class="actions" data-id="${m.id}" data-name="${escapeHtml(m.name)}" placement="bottom-end">
                      <wa-button slot="trigger" appearance="plain" size="l">
                        <wa-icon name="ellipsis-vertical" label="More actions for ${escapeHtml(m.name)}"></wa-icon>
                      </wa-button>
                      ${sharingEnabled ? '<wa-dropdown-item value="link"><wa-icon slot="icon" name="link"></wa-icon>Share link</wa-dropdown-item>' : ''}
                      <wa-dropdown-item value="share"><wa-icon slot="icon" name="share-2"></wa-icon>Share file</wa-dropdown-item>
                      <wa-dropdown-item value="edit"><wa-icon slot="icon" name="pencil"></wa-icon>Edit tiepoints</wa-dropdown-item>
                      <wa-dropdown-item value="delete" variant="danger"><wa-icon slot="icon" name="trash-2"></wa-icon>Delete</wa-dropdown-item>
                    </wa-dropdown>
                  </li>
                  <wa-divider></wa-divider>`).join('')}
               </ul>`
          }
        </main>
        <footer class="action-bar wa-grid wa-gap-s" style="--min-column-size: 8rem">
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
        <wa-dialog id="cm-link-dialog" label="Share link" light-dismiss>
          <div class="wa-cluster wa-gap-s wa-align-items-center" data-state="busy">
            <wa-spinner></wa-spinner> <span class="wa-body-m">Preparing link…</span>
          </div>
          <div class="wa-stack wa-gap-m" data-state="ready">
            <div class="wa-cluster wa-justify-content-center">
              <wa-qr-code size="200" label="Scan to open this map"></wa-qr-code>
            </div>
            <div class="wa-flank:end wa-gap-2xs wa-align-items-end">
              <wa-input label="Link" readonly></wa-input>
              <wa-copy-button copy-label="Copy link"></wa-copy-button>
            </div>
          </div>
          <wa-callout variant="warning" data-state="failed">
            <wa-icon slot="icon" name="circle-alert"></wa-icon>
            <span></span>
          </wa-callout>
          <div slot="footer" class="wa-cluster wa-gap-s wa-justify-content-end">
            <wa-button id="cm-link-file" appearance="outlined" data-state="failed">
              <wa-icon slot="start" name="share-2"></wa-icon> Share file instead
            </wa-button>
            <wa-button id="cm-link-share" variant="brand" data-state="ready">
              <wa-icon slot="start" name="share-2"></wa-icon> Share
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
      try {
        await this.importKmz(await readNow(file), file.name.replace(/\.kmz$/i, ''));
      } catch (err) {
        showToast(`Could not read that file: ${(err as Error).message}`);
      }
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

    // Per-map menu: share, edit tiepoints, delete (with confirmation)
    const dialog = this.root.querySelector('wa-dialog')!;
    let pendingDelete: string | null = null;
    this.root.querySelectorAll<HTMLElement>('wa-dropdown.actions').forEach(menu => {
      const { id, name } = menu.dataset as { id: string; name: string };
      menu.addEventListener('wa-select', async (e) => {
        const action = (e.detail.item as HTMLElement & { value: string }).value;
        if (action === 'delete') {
          pendingDelete = id;
          document.getElementById('cm-delete-text')!.textContent =
            `"${name}" will be removed from this device. Exported .kmz files are not affected.`;
          dialog.open = true;
          return;
        }
        const rec = await mapStore.get(id);
        if (!rec) return;
        if (action === 'share') await shareKmz(rec.kmzBlob, rec.name);
        if (action === 'link') await this.shareLink(rec.kmzBlob, rec.name);
        if (action === 'edit') {
          try {
            const overlay = await readKmz(rec.kmzBlob);
            new MapEditor(() => this.render(), { id, name: rec.name, createdAt: rec.createdAt, overlay }).mount(this.root);
          } catch (err) {
            showToast(`Could not open map: ${(err as Error).message}`);
          }
        }
      });
    });
    document.getElementById('cm-delete-confirm')!.addEventListener('click', async () => {
      if (!pendingDelete) return;
      await mapStore.delete(pendingDelete);
      dialog.open = false;
      await this.render();
    });
  }

  // Publishes the map and shows its short link (QR code, copy, share sheet). Sharing happens on
  // a second tap: after an upload the share sheet would refuse to open without a fresh gesture.
  private async shareLink(kmz: Blob, name: string): Promise<void> {
    const dialog = this.root.querySelector<HTMLElement & { open: boolean }>('#cm-link-dialog')!;
    const show = (state: string) =>
      dialog.querySelectorAll<HTMLElement>('[data-state]').forEach((el) => { el.hidden = el.dataset.state !== state; });
    const shareButton = dialog.querySelector<HTMLElement>('#cm-link-share')!;
    const fileButton = dialog.querySelector<HTMLElement>('#cm-link-file')!;
    fileButton.onclick = () => { dialog.open = false; void shareKmz(kmz, name); };
    show('busy');
    dialog.open = true;
    let url: string;
    try {
      url = `${appUrl()}m/${await publishKmz(kmz)}`;
    } catch (err) {
      dialog.querySelector('wa-callout span')!.textContent = `Couldn't create a link: ${(err as Error).message}.`;
      show('failed');
      return;
    }
    dialog.querySelector('wa-qr-code')!.value = url;
    dialog.querySelector('wa-input')!.value = url;
    dialog.querySelector('wa-copy-button')!.value = url;
    shareButton.onclick = () => navigator.share({ title: name, text: `"${name}" — a live GPS map in Custom Maps:`, url })
      .catch(() => { /* closed the share sheet */ });
    show('ready');
    shareButton.hidden = !navigator.share; // desktop browsers: the copy button is enough
  }

  // Opens a map someone shared by link, saving it so it works offline from then on.
  private async openShared(id: string): Promise<void> {
    const recId = `shared-${id}`;
    try {
      let rec = await mapStore.get(recId);
      if (!rec) {
        const res = await fetch(sharedKmzUrl(id));
        if (!res.ok) throw new Error(res.status === 404 ? 'it no longer exists' : `HTTP ${res.status}`);
        const kmzBlob = await res.blob();
        const overlay = await readKmz(kmzBlob);
        rec = { id: recId, name: overlay.name || 'Shared map', kmzBlob, createdAt: Date.now() };
        await mapStore.put(rec);
      }
      await this.render();
      this.openMap(await readKmz(rec.kmzBlob));
    } catch (err) {
      await this.render();
      showToast(`Could not open the shared map: ${(err as Error).message}`);
    }
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

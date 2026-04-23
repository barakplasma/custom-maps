import { readKmz } from '../io/KmzReader';
import { mapStore } from '../storage/MapStore';
import type { GroundOverlay } from '../core/GroundOverlay';
import { MapView } from './MapView';
import { MapEditor } from './editor/MapEditor';

export class MapLibrary {
  constructor(private root: HTMLElement) {}

  mount(): void {
    this.render();
  }

  private async render(): Promise<void> {
    const maps = await mapStore.list();
    maps.sort((a, b) => b.createdAt - a.createdAt);

    this.root.innerHTML = `
      <style>
        #cm-library nav { position: sticky; top: 0; z-index: 10; }
        #cm-library .map-list { list-style: none; padding: 0; margin: 0; }
        #cm-library .map-list li {
          display: flex; align-items: center; gap: .5rem;
          padding: .75rem 0; border-bottom: 1px solid var(--pico-muted-border-color, #e0e0e0);
        }
        #cm-library .map-list li button.open { flex: 1; text-align: left; background: none; border: none;
          cursor: pointer; padding: .5rem; border-radius: .25rem; font-size: 1rem; }
        #cm-library .map-list li button.open:hover { background: var(--pico-primary-background, #f0f4ff); }
        #cm-library .map-list li button.del { min-width: 44px; min-height: 44px; }
        #cm-library .empty { text-align: center; padding: 3rem 1rem; color: var(--pico-muted-color, #888); }
        #cm-library input[type=file] { display: none; }
      </style>
      <div id="cm-library">
        <nav>
          <ul><li><strong>Custom Maps</strong></li></ul>
          <ul>
            <li><button id="cm-import" class="outline">Open file</button></li>
            <li><button id="cm-create">Create map</button></li>
          </ul>
        </nav>
        <main class="container">
          <input type="file" id="cm-file-input" accept=".kmz">
          ${maps.length === 0
            ? '<p class="empty">No maps yet. Open a .kmz file or create a new map.</p>'
            : `<ul class="map-list">
                ${maps.map(m => `
                  <li>
                    <button class="open" data-id="${m.id}">${escapeHtml(m.name)}</button>
                    <button class="del outline" data-del="${m.id}" aria-label="Delete" style="min-width:44px;min-height:44px;">×</button>
                  </li>`).join('')}
               </ul>`
          }
        </main>
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

    this.root.querySelectorAll<HTMLButtonElement>('button.open').forEach(btn => {
      btn.addEventListener('click', async () => {
        const rec = await mapStore.get(btn.dataset.id!);
        if (!rec) return;
        try {
          const overlay = await readKmz(rec.kmzBlob);
          this.openMap(overlay);
        } catch (err) {
          showToast(`Could not open map: ${(err as Error).message}`, this.root);
        }
      });
    });

    // Two-tap delete: first tap → "Sure?", second tap → delete
    this.root.querySelectorAll<HTMLButtonElement>('button.del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (btn.dataset.confirm !== '1') {
          btn.dataset.confirm = '1';
          btn.textContent = 'Sure?';
          btn.style.color = 'var(--pico-del-color, #c0392b)';
          setTimeout(() => {
            if (btn.dataset.confirm === '1') {
              btn.dataset.confirm = '';
              btn.textContent = '×';
              btn.style.color = '';
            }
          }, 3000);
          return;
        }
        await mapStore.delete(btn.dataset.del!);
        await this.render();
      });
    });
  }

  private async importKmz(blob: Blob, name: string): Promise<void> {
    try {
      const overlay = await readKmz(blob);
      await mapStore.put({ id: crypto.randomUUID(), name: overlay.name || name, kmzBlob: blob, createdAt: Date.now() });
      await this.render();
      this.openMap(overlay);
    } catch (err) {
      showToast(`Failed to open KMZ: ${(err as Error).message}`, this.root);
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

function showToast(message: string, container: HTMLElement): void {
  const t = document.createElement('div');
  t.textContent = message;
  t.style.cssText = 'position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:.5rem 1rem;border-radius:.5rem;font-size:.85rem;z-index:2000;max-width:90vw;text-align:center;';
  container.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

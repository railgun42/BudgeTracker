import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MIME_TYPES, AttachmentDto, AttachmentUrlDto, TransactionDto } from '@budgetracker/shared';
import { Observable } from 'rxjs';
import { ApiClient } from '../../core/api-client';
import { errorMessage } from '../auth/auth-form';

// Pièce jointe d'une transaction (SPEC §4) : une seule, JPEG/PNG/WebP/PDF, 5 Mo. Le serveur revérifie tout
// (signature du fichier, taille, quota) ; les contrôles ici évitent seulement un envoi inutile.
@Component({
  selector: 'app-attachment-control',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'attachment' },
  template: `
    @if (transaction().attachment; as file) {
      <span class="muted">Justificatif : {{ file.originalName }} ({{ kb(file.sizeBytes) }} Ko)</span>
      <button type="button" class="button button-secondary" [disabled]="pending()" (click)="open()">
        Ouvrir<span class="visually-hidden"> la pièce jointe {{ file.originalName }}</span>
      </button>
      <button type="button" class="button button-secondary" [disabled]="pending()" (click)="remove()">
        Retirer<span class="visually-hidden"> la pièce jointe {{ file.originalName }}</span>
      </button>
    } @else {
      <label [for]="inputId()">Joindre un justificatif (JPEG, PNG, WebP ou PDF, 5 Mo max)</label>
      <input type="file" [id]="inputId()" [accept]="accept" [disabled]="pending()" (change)="upload($event)" />
    }
    @if (error()) {
      <p class="field-error" role="alert">{{ error() }}</p>
    }
  `,
  styles: `
    // Pied de ligne sous un filet ; les boutons et le champ fichier gardent 44 px de cible.
    :host {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
      flex-basis: 100%;
      padding-top: var(--space-2);
      border-top: 1px solid var(--color-border);
      font-size: var(--text-sm);
      overflow-wrap: anywhere;
    }
    label {
      flex-basis: 100%;
      color: var(--color-text-muted);
    }
    input[type='file'] {
      max-width: 100%;
      min-height: var(--tap);
      font: inherit;
    }
    span.muted {
      flex: 1 1 12rem;
    }
    .field-error {
      flex-basis: 100%;
      margin: 0;
    }
  `,
})
export class AttachmentControl {
  private readonly api = inject(ApiClient);

  readonly transaction = input.required<TransactionDto>();
  /** Nouvelle pièce, ou null après retrait. */
  readonly changed = output<AttachmentDto | null>();

  protected readonly accept = ATTACHMENT_MIME_TYPES.join(',');
  protected readonly inputId = computed(() => `attachment-${this.transaction().id}`);
  private readonly path = computed(() => `/transactions/${this.transaction().id}/attachment`);
  protected readonly pending = signal(false);
  protected readonly error = signal<string | null>(null);

  protected kb(bytes: number): number {
    return Math.ceil(bytes / 1024);
  }

  protected upload(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > ATTACHMENT_MAX_BYTES) return this.error.set('Fichier trop volumineux (5 Mo max).');
    if (!(ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type)) return this.error.set('Format non accepté : JPEG, PNG, WebP ou PDF.');
    const body = new FormData();
    body.append('file', file);
    this.run(this.api.post<AttachmentDto>(this.path(), body), (dto) => this.changed.emit(dto));
  }

  /** Onglet ouvert pendant le clic (sinon bloqué comme popup), puis dirigé vers l'URL signée de courte durée. */
  protected open(): void {
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    this.run(this.api.get<AttachmentUrlDto>(this.path()), ({ url }) => (tab ? (tab.location.href = url) : window.location.assign(url)), () => tab?.close());
  }

  protected remove(): void {
    this.run(this.api.delete(this.path()), () => this.changed.emit(null));
  }

  private run<T>(request: Observable<T>, next: (value: T) => void, onError?: () => void): void {
    this.pending.set(true);
    this.error.set(null);
    request.subscribe({
      next: (value) => {
        this.pending.set(false);
        next(value);
      },
      error: (e) => {
        this.pending.set(false);
        onError?.();
        this.error.set(
          errorMessage(e, {
            404: 'Cette pièce ou cette transaction n’existe plus. Rechargez la liste.',
            409: 'Cette transaction a déjà une pièce jointe. Rechargez la liste.',
            413: 'Fichier trop volumineux (5 Mo max).',
            415: 'Format non accepté : JPEG, PNG, WebP ou PDF.',
            422: 'Espace de stockage plein : retirez d’anciennes pièces jointes.',
          }),
        );
      },
    });
  }
}

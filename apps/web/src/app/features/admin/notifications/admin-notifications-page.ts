import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { addDays, CreateAnnouncementInput, CreateNotificationInput, LocalDate, NOTIFICATION_MAX_LENGTH, SentMessageDto, TERMS_NOTICE_DAYS } from '@budgetracker/shared';
import { merge } from 'rxjs';
import { ApiClient } from '../../../core/api-client';
import { today } from '../../../core/today';
import { errorMessage } from '../../auth/auth-form';
import { NOTIFICATION_ICONS, notificationKindLabel } from '../../notifications/notifications';

const max = NOTIFICATION_MAX_LENGTH;
const DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const messageValidators = [Validators.required, Validators.maxLength(max), Validators.pattern(/\S/)];
const frDate = (d: LocalDate) => d.split('-').reverse().join('/');

/** Texte proposé pour une modification des CGU (SPEC §13.6) : préavis, poursuite d'utilisation = acceptation. */
export const termsMessage = (effective: LocalDate) =>
  `Les conditions générales d'utilisation évoluent : la nouvelle version entrera en vigueur le ${frDate(effective)}. ` +
  `Vous pouvez la consulter sur la page CGU. Aucune action n'est nécessaire : la poursuite de l'utilisation du service après cette date vaudra acceptation.`;

// E40 (SPEC §13.6) : annonce à tous et notification à un utilisateur précis. Route réservée aux admins.
@Component({
  selector: 'app-admin-notifications-page',
  imports: [NgTemplateOutlet, ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="head">
      <p class="back"><a routerLink="/admin">← Administration</a></p>
      <h1>Notifications et annonces</h1>
    </header>

    @if (error()) {
      <p class="alert alert-error" role="alert">{{ error() }}</p>
    }
    <div aria-live="polite">
      @if (status() && !error()) {
        <p class="alert alert-success confirm-pop">{{ status() }}</p>
      }
    </div>

    <section class="card" aria-labelledby="announcement-title">
      <h2 class="card-title" id="announcement-title">
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="icons.ANNOUNCEMENT" /></svg>
        Annonce à tous
      </h2>
      <p class="alert" id="gdpr-reminder">
        Une annonce ne remplace pas l'e-mail. Pour une modification des CGU, un e-mail à tous les utilisateurs est
        obligatoire (RGPD) : il s'envoie hors de l'application (procédure d'exploitation), avec le même préavis.
      </p>
      <form class="form" [formGroup]="announcement" (ngSubmit)="announce()" novalidate aria-describedby="gdpr-reminder">
        <div class="field">
          <label class="checkbox">
            <input type="checkbox" id="announcement-terms" formControlName="terms" />
            <span>Modification des CGU (message prérempli, préavis de {{ notice }} jours)</span>
          </label>
        </div>
        @if (terms()) {
          <div class="field">
            <label for="announcement-effective">Entrée en vigueur</label>
            <input
              id="announcement-effective"
              type="date"
              formControlName="effective"
              [min]="minEffective"
              aria-describedby="announcement-effective-date announcement-effective-hint"
            />
            @if (value().effective; as d) {
              <p id="announcement-effective-date" class="field-hint">
                Entrée en vigueur le <time [attr.datetime]="d">{{ day(d) }}</time>.
              </p>
            }
            <!-- Préavis court : avertissement écrit (icône + texte), pas une erreur : l'envoi reste possible. -->
            <p id="announcement-effective-hint" [class]="shortNotice() ? 'field-warning' : 'field-hint'">
              @if (shortNotice()) {
                <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="warningIcon" /></svg>
                Préavis inférieur à {{ notice }} jours.
              } @else {
                Préavis de {{ notice }} jours au moins. Aucune ré-acceptation n'est demandée aux utilisateurs.
              }
            </p>
          </div>
        }
        <div class="field">
          <label for="announcement-message">Message</label>
          <textarea
            id="announcement-message"
            formControlName="message"
            rows="5"
            [attr.maxlength]="max"
            [attr.aria-invalid]="invalid(announcement.controls.message)"
            aria-describedby="announcement-message-hint announcement-message-count"
          ></textarea>
          <p id="announcement-message-hint" [class]="invalid(announcement.controls.message) ? 'field-error' : 'field-hint'">
            Obligatoire, {{ max }} caractères au plus, affiché en texte brut.
          </p>
          <ng-container *ngTemplateOutlet="counter; context: { $implicit: announcementText().length, id: 'announcement-message-count' }" />
        </div>
        @if (announcementText().trim()) {
          <ng-container *ngTemplateOutlet="preview; context: { icon: icons.ANNOUNCEMENT, label: kindLabel('ANNOUNCEMENT'), message: announcementText().trim() }" />
        }
        <div class="actions">
          <button class="button" type="submit" [disabled]="pending()">Envoyer à tous</button>
        </div>
      </form>
    </section>

    <section class="card" aria-labelledby="personal-title">
      <h2 class="card-title" id="personal-title">
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="icons.PERSONAL" /></svg>
        Notification à un utilisateur
      </h2>
      <form class="form" [formGroup]="personal" (ngSubmit)="notify()" novalidate>
        <div class="field">
          <label for="notification-email">E-mail du destinataire</label>
          <input
            id="notification-email"
            type="email"
            formControlName="email"
            autocomplete="off"
            [attr.aria-invalid]="invalid(personal.controls.email)"
            aria-describedby="notification-email-hint"
          />
          <p id="notification-email-hint" [class]="invalid(personal.controls.email) ? 'field-error' : 'field-hint'">
            Obligatoire : l'adresse e-mail d'un compte existant.
          </p>
        </div>
        <div class="field">
          <label for="notification-message">Message</label>
          <textarea
            id="notification-message"
            formControlName="message"
            rows="4"
            [attr.maxlength]="max"
            [attr.aria-invalid]="invalid(personal.controls.message)"
            aria-describedby="notification-message-hint notification-message-count"
          ></textarea>
          <p id="notification-message-hint" [class]="invalid(personal.controls.message) ? 'field-error' : 'field-hint'">
            Obligatoire, {{ max }} caractères au plus, affiché en texte brut.
          </p>
          <ng-container *ngTemplateOutlet="counter; context: { $implicit: personalText().length, id: 'notification-message-count' }" />
        </div>
        @if (personalText().trim()) {
          <ng-container *ngTemplateOutlet="preview; context: { icon: icons.PERSONAL, label: kindLabel('PERSONAL'), message: personalText().trim() }" />
        }
        <div class="actions">
          <button class="button" type="submit" [disabled]="pending()">{{ pending() ? 'Envoi en cours…' : 'Envoyer' }}</button>
        </div>
      </form>
    </section>

    <!-- Envoi à tous : récapitulatif avant l'envoi. Page derrière inerte, d'où l'erreur répétée dedans. -->
    <dialog #announceDialog class="modal" aria-labelledby="announce-dialog-title">
      <h2 id="announce-dialog-title">Envoyer l'annonce à tous ?</h2>
      @if (error()) {
        <p class="alert alert-error" role="alert">{{ error() }}</p>
      }
      <p>Tous les utilisateurs la recevront dans leurs notifications.</p>
      @if (terms() && value().effective; as d) {
        <p>Modification des CGU : entrée en vigueur le <time [attr.datetime]="d">{{ day(d) }}</time>.</p>
        @if (shortNotice()) {
          <p class="field-warning">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="warningIcon" /></svg>
            Préavis inférieur à {{ notice }} jours.
          </p>
        }
      }
      <ng-container *ngTemplateOutlet="preview; context: { icon: icons.ANNOUNCEMENT, label: kindLabel('ANNOUNCEMENT'), message: announcementText().trim() }" />
      <div class="actions">
        <button class="button" type="button" [disabled]="pending()" (click)="confirmAnnounce()">
          {{ pending() ? 'Envoi en cours…' : 'Confirmer l’envoi à tous' }}
        </button>
        <button class="button button-secondary" type="button" (click)="announceDialog.close()">Annuler</button>
      </div>
    </dialog>

    <!-- Compteur : ton d'avertissement (icône + texte) à 90 % de la limite ; le dépassement est empêché par maxlength. -->
    <ng-template #counter let-n let-id="id">
      @if (n >= nearMax) {
        <p [id]="id" class="field-warning">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="warningIcon" /></svg>
          {{ n }} / {{ max }} caractères : plus que {{ max - n }}.
        </p>
      } @else {
        <p [id]="id" class="field-hint">{{ n }} / {{ max }} caractères.</p>
      }
    </ng-template>

    <!-- Aperçu : même ligne que la page Notifications (§3.13), texte brut tel qu'il sera envoyé (rogné). -->
    <ng-template #preview let-icon="icon" let-label="label" let-message="message">
      <figure class="preview">
        <figcaption class="muted">Aperçu, tel que l'utilisateur le verra</figcaption>
        <div class="row unread-row">
          <p class="row-head">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="icon" /></svg>
            <strong>{{ label }}</strong><span class="visually-hidden"> · </span>
            <span class="muted">À l'envoi</span><span class="visually-hidden"> · </span>
            <span class="unread-mark">Non lue</span>
          </p>
          <p class="message">{{ message }}</p>
        </div>
      </figure>
    </ng-template>
  `,
  // Mise en page seulement : champs, bandeaux, modale, marque « Non lue » et boutons viennent de la charte (styles.scss).
  styles: `
    :host {
      display: grid;
      gap: var(--space-4);
      max-width: 40rem;
    }
    .head {
      display: grid;
      gap: var(--space-2);
    }
    .back,
    h1,
    .alert {
      margin: 0;
    }
    .card {
      display: grid;
      gap: var(--space-3);
    }
    .card-title {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin: 0;
    }
    .form {
      max-width: none;
      margin: 0;
    }
    .icon {
      flex: none;
      width: 1.25em;
      height: 1.25em;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .card-title .icon {
      color: var(--color-primary);
    }
    .modal > p {
      margin: 0 0 var(--space-3);
    }
    // Aperçu : cadre pointillé pour le distinguer d'une vraie notification.
    .preview {
      display: grid;
      gap: var(--space-1);
      margin: 0 0 var(--space-3);
      figcaption {
        font-size: var(--text-sm);
      }
    }
    .form .preview {
      margin: 0;
    }
    .row {
      display: grid;
      gap: var(--space-1);
      padding: var(--space-3);
      border: 1px dashed var(--color-border-strong);
      border-radius: var(--radius);
      p {
        margin: 0;
      }
    }
    .row-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-1) var(--space-2);
      font-size: var(--text-sm);
    }
    .message {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
  `,
})
export class AdminNotificationsPage {
  private readonly api = inject(ApiClient);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly max = max;
  protected readonly notice = TERMS_NOTICE_DAYS;
  protected readonly minEffective = today();

  protected readonly pending = signal(false);
  protected readonly error = signal('');
  protected readonly status = signal('');

  protected readonly announcement = this.fb.group({
    terms: false,
    effective: addDays(today(), TERMS_NOTICE_DAYS),
    message: ['', messageValidators],
  });
  protected readonly personal = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    message: ['', messageValidators],
  });

  protected readonly value = toSignal(this.announcement.valueChanges, { initialValue: this.announcement.getRawValue() });
  protected readonly terms = computed(() => this.value().terms);
  // Affichage seulement : compteurs, aperçus, date lisible, icônes.
  private readonly personalValue = toSignal(this.personal.valueChanges, { initialValue: this.personal.getRawValue() });
  protected readonly announcementText = computed(() => this.value().message ?? '');
  protected readonly personalText = computed(() => this.personalValue().message ?? '');
  protected readonly nearMax = Math.ceil(max * 0.9);
  protected readonly day = (d: LocalDate) => DAY.format(new Date(`${d}T00:00:00Z`));
  protected readonly icons = NOTIFICATION_ICONS;
  protected readonly kindLabel = notificationKindLabel;
  protected readonly warningIcon = 'M12 3 2 21h20L12 3zM12 10v5M12 18v.01';
  private readonly announceDialog = viewChild.required<ElementRef<HTMLDialogElement>>('announceDialog');
  protected readonly shortNotice = computed(() => (this.value().effective ?? '') < addDays(today(), TERMS_NOTICE_DAYS));

  constructor() {
    // Case cochée ou date modifiée : le message CGU est (re)proposé, toujours modifiable ensuite.
    const { terms, effective, message } = this.announcement.controls;
    merge(terms.valueChanges, effective.valueChanges)
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        if (terms.value) message.setValue(termsMessage(effective.value));
      });
  }

  protected invalid(c: { invalid: boolean; touched: boolean }): boolean {
    return c.invalid && c.touched;
  }

  protected announce(): void {
    const { message } = this.announcement.controls;
    if (message.invalid) return void message.markAsTouched();
    this.error.set('');
    this.announceDialog().nativeElement.showModal();
  }

  // Bouton de la modale récapitulative : envoi, puis fermeture après succès (elle reste ouverte sur erreur).
  protected confirmAnnounce(): void {
    const body: CreateAnnouncementInput = { message: this.announcement.controls.message.value.trim() };
    this.send('/admin/announcements', body, 'Annonce envoyée à tous les utilisateurs.', () => {
      this.announcement.reset();
      this.announceDialog().nativeElement.close();
    });
  }

  protected notify(): void {
    if (this.personal.invalid) return void this.personal.markAllAsTouched();
    const { email, message } = this.personal.getRawValue();
    const body: CreateNotificationInput = { email: email.trim(), message: message.trim() };
    this.send('/admin/notifications', body, 'Notification envoyée.', () => this.personal.reset());
  }

  private send(path: string, body: unknown, done: string, reset: () => void): void {
    this.pending.set(true);
    this.api.post<SentMessageDto>(path, body).subscribe({
      next: () => {
        this.pending.set(false);
        this.error.set('');
        this.status.set(done);
        reset();
      },
      error: (e) => {
        this.pending.set(false);
        this.error.set(
          errorMessage(e, {
            400: `Message vide ou trop long (${max} caractères au plus), ou e-mail invalide.`,
            403: 'Accès réservé aux administrateurs.',
            404: 'Aucun utilisateur avec cet e-mail.',
          }),
        );
      },
    });
  }
}

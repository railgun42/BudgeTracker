import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { addDays, CreateAnnouncementInput, CreateNotificationInput, LocalDate, NOTIFICATION_MAX_LENGTH, SentMessageDto, TERMS_NOTICE_DAYS } from '@budgetracker/shared';
import { merge } from 'rxjs';
import { ApiClient } from '../../../core/api-client';
import { today } from '../../../core/today';
import { errorMessage } from '../../auth/auth-form';

const max = NOTIFICATION_MAX_LENGTH;
const messageValidators = [Validators.required, Validators.maxLength(max), Validators.pattern(/\S/)];
const frDate = (d: LocalDate) => d.split('-').reverse().join('/');

/** Texte proposé pour une modification des CGU (SPEC §13.6) : préavis, poursuite d'utilisation = acceptation. */
export const termsMessage = (effective: LocalDate) =>
  `Les conditions générales d'utilisation évoluent : la nouvelle version entrera en vigueur le ${frDate(effective)}. ` +
  `Vous pouvez la consulter sur la page CGU. Aucune action n'est nécessaire : la poursuite de l'utilisation du service après cette date vaudra acceptation.`;

// E40 (SPEC §13.6) : annonce à tous et notification à un utilisateur précis. Route réservée aux admins.
@Component({
  selector: 'app-admin-notifications-page',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p><a routerLink="/admin">← Administration</a></p>
    <h1>Notifications et annonces</h1>

    @if (error()) {
      <p class="alert alert-error" role="alert">{{ error() }}</p>
    }
    <p class="visually-hidden" aria-live="polite">{{ status() }}</p>

    <h2>Annonce à tous</h2>
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
          <input id="announcement-effective" type="date" formControlName="effective" [min]="minEffective" aria-describedby="announcement-effective-hint" />
          <p id="announcement-effective-hint" [class]="shortNotice() ? 'field-error' : 'field-hint'">
            @if (shortNotice()) {
              Préavis inférieur à {{ notice }} jours.
            } @else {
              Préavis de {{ notice }} jours au moins. Aucune ré-acceptation n'est demandée aux utilisateurs.
            }
          </p>
        </div>
      }
      <div class="field">
        <label for="announcement-message">Message</label>
        <textarea id="announcement-message" formControlName="message" rows="5" [attr.maxlength]="max" [attr.aria-invalid]="invalid(announcement.controls.message)"></textarea>
        <p class="field-hint">Obligatoire, {{ max }} caractères au plus, affiché en texte brut.</p>
      </div>
      <button class="button" type="submit" [disabled]="pending()">Envoyer à tous</button>
    </form>

    <h2>Notification à un utilisateur</h2>
    <form class="form" [formGroup]="personal" (ngSubmit)="notify()" novalidate>
      <div class="field">
        <label for="notification-email">E-mail du destinataire</label>
        <input id="notification-email" type="email" formControlName="email" autocomplete="off" [attr.aria-invalid]="invalid(personal.controls.email)" />
      </div>
      <div class="field">
        <label for="notification-message">Message</label>
        <textarea id="notification-message" formControlName="message" rows="4" [attr.maxlength]="max" [attr.aria-invalid]="invalid(personal.controls.message)"></textarea>
      </div>
      <button class="button" type="submit" [disabled]="pending()">Envoyer</button>
    </form>
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

  private readonly value = toSignal(this.announcement.valueChanges, { initialValue: this.announcement.getRawValue() });
  protected readonly terms = computed(() => this.value().terms);
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
    const body: CreateAnnouncementInput = { message: message.value.trim() };
    this.send('/admin/announcements', body, 'Annonce envoyée à tous les utilisateurs.', () => this.announcement.reset());
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

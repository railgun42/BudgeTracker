import { afterNextRender, ChangeDetectionStrategy, Component, ElementRef, inject, output, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TrackingType } from '../../enums/trackingType';

export type AccountFormValue = { name: string; startingBalance: number; tracking: TrackingType };

@Component({
  selector: 'app-account-form-modal',
  imports: [ReactiveFormsModule],
  templateUrl: './account-form-modal.html',
  styleUrl: './account-form-modal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountFormModal {
  saved = output<AccountFormValue>();
  closed = output<void>();

  protected readonly TrackingType = TrackingType;
  private dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected form = inject(FormBuilder).nonNullable.group({
    name: ['', Validators.required],
    startingBalance: [0 as number | null],
    tracking: TrackingType.NORMAL,
  });

  constructor() {
    // Compte non suivi : pas de solde de départ (le solde n'est pas suivi)
    this.form.controls.tracking.valueChanges.pipe(takeUntilDestroyed()).subscribe((tracking) => {
      const balance = this.form.controls.startingBalance;
      if (tracking === TrackingType.NOT_TRACKED) {
        balance.setValue(0);
        balance.disable();
      } else {
        balance.enable();
      }
    });
    // <dialog> natif : fond (::backdrop), piège à focus et touche Échap gérés par le navigateur
    afterNextRender(() => this.dialog().nativeElement.showModal());
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.saved.emit({ name: v.name.trim(), startingBalance: v.tracking === TrackingType.NOT_TRACKED ? 0 : (v.startingBalance ?? 0), tracking: v.tracking });
  }

  // Clic sur le fond gris (en dehors du contenu) : ferme
  onDialogClick(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.closed.emit();
  }
}

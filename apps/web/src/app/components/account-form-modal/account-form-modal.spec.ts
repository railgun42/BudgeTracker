import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AccountFormModal } from './account-form-modal';

describe('AccountFormModal', () => {
  let component: AccountFormModal;
  let fixture: ComponentFixture<AccountFormModal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AccountFormModal],
    }).compileComponents();

    fixture = TestBed.createComponent(AccountFormModal);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

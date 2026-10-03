import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NewTransactionPage } from './new-transaction-page';

describe('NewTransactionPage', () => {
  let component: NewTransactionPage;
  let fixture: ComponentFixture<NewTransactionPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NewTransactionPage],
    }).compileComponents();

    fixture = TestBed.createComponent(NewTransactionPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

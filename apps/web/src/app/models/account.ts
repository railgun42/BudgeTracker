import { Transaction } from "./transaction";
import { Recurrence } from "./recurrence";
import { TrackingType } from "../enums/trackingType";
import { TypeTransaction } from "../enums/typeTransaction";

export class Account {
    private readonly id: number;
    private name: string;
    private history: Transaction[];
    private recurrences: Recurrence[];
    private tracking: TrackingType;

    constructor(id: number, name: string, history: Transaction[], recurrences: Recurrence[], tracking: TrackingType = TrackingType.NORMAL) {
        this.id = id;
        this.name = name;
        this.history = history;
        this.recurrences = recurrences;
        this.tracking = tracking;
    }

    // ?? : les comptes enregistrés avant l'ajout du champ n'ont pas de tracking
    public getTracking(): TrackingType {
        return this.tracking ?? TrackingType.NORMAL;
    }

    public getBalance(): number {
        const total = this.history.reduce(
            (sum, t) => sum + (t.getType() === TypeTransaction.CREDIT ? t.getAmount() : -t.getAmount()), 0);
        return Math.round(total * 100) / 100;
    }

    public getId(): number {
        return this.id;
    }

    public getName(): string {
        return this.name;
    }

    public setName(name: string): void {
        this.name = name;
    }

    public getHistory(): Transaction[] {
        return this.history;
    }

    public setHistory(history: Transaction[]): void {
        this.history = history;
    }

    public addTransaction(t:Transaction){
        this.history.push(t);
    }

    public removeTransaction(t: Transaction): void {
        this.history = this.history.filter(tr => tr.getId() !== t.getId());
    }

    public getRecurrences(): Recurrence[] {
        return this.recurrences;
    }

    public setRecurrences(recurrences: Recurrence[]): void {
        this.recurrences = recurrences;
    }
}
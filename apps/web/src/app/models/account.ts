import { Transaction } from "./transaction";
import { Recurrence } from "./recurrence";

export class Account {
    private readonly id: number;
    private name: string;
    private history: Transaction[];
    private recurrences: Recurrence[];

    constructor(id: number, name: string, history: Transaction[], recurrences: Recurrence[]) {
        this.id = id;
        this.name = name;
        this.history = history;
        this.recurrences = recurrences;
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

    public getRecurrences(): Recurrence[] {
        return this.recurrences;
    }

    public setRecurrences(recurrences: Recurrence[]): void {
        this.recurrences = recurrences;
    }
}
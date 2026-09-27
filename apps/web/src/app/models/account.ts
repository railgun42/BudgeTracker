import { Transaction } from "./transaction";
import { Recurrence } from "./recurrence";

export class Account{
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
}
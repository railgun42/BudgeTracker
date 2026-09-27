import { Transaction } from "./transaction";
import { Recurrrence } from "./recurrrence";

export class Account{
    private readonly id: number;
    private name: string;
    private history: Transaction[];
    private recurrences: Recurrrence[];

    constructor(id: number, name: string, history: Transaction[], recurrences: Recurrrence[]) {
        this.id = id;
        this.name = name;
        this.history = history;
        this.recurrences = recurrences;
    }
}
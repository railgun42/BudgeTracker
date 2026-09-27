import { IntervalUnit } from "../enums/intervalUnit";
import { Transaction } from "./transaction";
import { TransactionTemplate } from "./transactionTemplate";


export class Recurrence{
    private readonly id: number;
    private startDate: Date;
    private endDate: Date;
    private interval: number;
    private unit: IntervalUnit;
    private lastGeneration: Date;
    private template: TransactionTemplate;
    private generatedTransactions: Transaction[]

    constructor(
        id: number,
        startDate: Date,
        endDate: Date,
        interval: number,
        unit: IntervalUnit,
        lastGeneration: Date,
        template: TransactionTemplate,
        generatedTransactions: Transaction[]
    ) {
        this.id = id;
        this.startDate = startDate;
        this.endDate = endDate;
        this.interval = interval;
        this.unit = unit;
        this.lastGeneration = lastGeneration;
        this.template = template;
        this.generatedTransactions = generatedTransactions;
    }
}
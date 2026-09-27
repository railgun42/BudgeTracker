import { IntervalUnit } from "../enums/intervalUnit";
import { Transaction } from "./transaction";
import { TransactionTemplate } from "./transactionTemplate";


export class Recurrence{
    private readonly id: number;
    private startDate: Date;
    private endDate: Date;
    private interval: number;
    private unit: IntervalUnit;
    private lastGeneraion: Date;
    private template: TransactionTemplate;
    private generatedTranscations: Transaction[]

    constructor(
        id: number,
        startDate: Date,
        endDate: Date,
        interval: number,
        unit: IntervalUnit,
        lastGeneraion: Date,
        template: TransactionTemplate,
        generatedTranscations: Transaction[]
    ) {
        this.id = id;
        this.startDate = startDate;
        this.endDate = endDate;
        this.interval = interval;
        this.unit = unit;
        this.lastGeneraion = lastGeneraion;
        this.template = template;
        this.generatedTranscations = generatedTranscations;
    }
}
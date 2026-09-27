import { IntervalUnit } from "../enums/intervalUnit";

export class Recurrence{
    private readonly id: number;
    private startDate: Date;
    private endDate: Date;
    private interval: number;
    private unit: IntervalUnit;
    private lastGeneraion: Date;

    constructor(
        id: number,
        startDate: Date,
        endDate: Date,
        interval: number,
        unit: IntervalUnit,
        lastGeneraion: Date,
    ) {
        this.id = id;
        this.startDate = startDate;
        this.endDate = endDate;
        this.interval = interval;
        this.unit = unit;
        this.lastGeneraion = lastGeneraion;
    }
}
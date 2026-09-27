import { Category } from "./category";
import { Tag } from "./tag";
import { TypeTransaction } from "../enums/typeTransaction";
import { Attachment } from "./attachment";

export class Transaction{
    private readonly id: number;
    private name: string;
    private date: Date;
    private ammount: number;
    private type: TypeTransaction
    private details: string;
    private attachments: Attachment[];
    private category: Category;
    private tags: Tag[];

    constructor(
        id: number,
        name: string,
        date: Date,
        ammount: number,
        type: TypeTransaction,
        details: string,
        attachments: Attachment[],
        category: Category,
        tags: Tag[]
    ) {
        this.id = id;
        this.name = name;
        this.date = date;
        this.ammount = ammount;
        this.type = type;
        this.details = details;
        this.attachments = attachments
        this.category = category;
        this.tags = tags;
    }
}
import { Category } from "./category";
import { Tag } from "./tag";
import { TypeTransaction } from "../enums/typeTransaction";

export class Transaction{
    private readonly id: number;
    private name: string;
    private date: Date;
    private ammount: number;
    private type: TypeTransaction
    private details: string;
    //private PJ
    private category: Category;
    private tags: Tag[];

    constructor(
        id: number,
        name: string,
        date: Date,
        ammount: number,
        type: TypeTransaction,
        details: string,
        category: Categorie,
        tags: Tag[]
    ) {
        this.id = id;
        this.name = name;
        this.date = date;
        this.ammount = ammount;
        this.type = type;
        this.details = details;
        this.category = category;
        this.tags = tags;
    }
}
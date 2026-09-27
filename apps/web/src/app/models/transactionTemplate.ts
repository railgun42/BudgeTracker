import { Category } from "./category";
import { Tag } from "./tag";
import { TypeTransaction } from "../enums/typeTransaction";

export class TransactionTemplate{
    private name: string;
    private ammount: number;
    private type: TypeTransaction
    private details: string;
    private category: Category;
    private tags: Tag[];
    
    constructor(
        name: string,
        ammount: number,
        type: TypeTransaction,
        details: string,
        category: Category,
        tags: Tag[]
    ) {
        this.name = name;
        this.ammount = ammount;
        this.type = type;
        this.details = details;
        this.category = category;
        this.tags = tags;
    }
}
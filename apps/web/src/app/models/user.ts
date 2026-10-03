import { Account } from "./account";

export class User{
    private readonly id: number;
    private name: string;
    private mail: string;
    private phoneNumber: string;
    private lastConnection: Date;
    private accounts: Account[];

    constructor(id:number, name:string, mail:string, phoneNumber:string, lastConnection:Date, accounts:Account[]){
        this.id = id;
        this.name = name;
        this.mail = mail;
        this.phoneNumber = phoneNumber;
        this.lastConnection = lastConnection;
        this.accounts = accounts;    
    }

    public getAccounts():Account[] {
        return this.accounts;
    }
}


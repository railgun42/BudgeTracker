import { Account } from "./account";

export class User{
    private readonly id: number;
    private username: string;
    private mail: string;
    private phoneNumber: string;
    private lastConnection: Date;
    private accounts: Account[];

    constructor(id:number, username:string, mail:string, phoneNumber:string, lastConnection:Date, accounts:Account[]){
        this.id = id;
        this.username = username;
        this.mail = mail;
        this.phoneNumber = phoneNumber;
        this.lastConnection = lastConnection;
        this.accounts = accounts;    
    }

    public getId():number{
        return this.id;
    }

    public getUsername():string{
        return this.username;
    }

    public getAccounts():Account[] {
        return this.accounts;
    }
}


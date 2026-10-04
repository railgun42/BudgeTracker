export class Category {
    private readonly id: number;
    private name: string;
    // private icon
    private color: string;
    private parent?: Category;

    constructor(id: number, name: string, color: string, parent?: Category) {
        this.id = id;
        this.name = name;
        this.color = color;
        this.parent = parent;
    }

    public getId(): number {
        return this.id;
    }

    public getName(): string {
        return this.name;
    }

    public getParent(): Category | undefined {
        return this.parent;
    }
}
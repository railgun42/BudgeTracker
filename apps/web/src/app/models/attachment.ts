export class Attachment {
    id: number;
    fileName: string;
    mimeType: string;
    url: string;
    addedAt: Date;

    constructor(
        id: number,
        fileName: string,
        mimeType: string,
        url: string,
        addedAt: Date
    ) {
        this.id = id;
        this.fileName = fileName;
        this.mimeType = mimeType;
        this.url = url;
        this.addedAt = addedAt;
    }
}
declare module "pdf-parse/lib/pdf-parse.js" {
    interface PdfParseResult {
        text: string;
        numpages?: number;
        info?: Record<string, unknown>;
        metadata?: unknown;
        version?: string;
    }
    function pdfParse(
        data: Buffer | Uint8Array,
        opts?: Record<string, unknown>,
    ): Promise<PdfParseResult>;
    export default pdfParse;
}

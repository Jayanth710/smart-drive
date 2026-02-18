import logging
from docling.document_converter import DocumentConverter, ImageFormatOption, PdfFormatOption
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions, EasyOcrOptions, TableStructureOptions
from .text_extractor import extract_plain_text

logger = logging.getLogger(__name__)

_converter = None

def get_converter():
    global _converter
    if _converter is None:
        logger.info("Initializing Docling DocumentConverter (EasyOCR forced)...")

        opts = PdfPipelineOptions()
        opts.do_ocr = True

        # FORCE EasyOCR only (no auto)
        opts.ocr_options = EasyOcrOptions(lang=["en"], use_gpu=False)

        # Tables (optional)
        opts.do_table_structure = True
        opts.table_structure_options = TableStructureOptions(do_cell_matching=True)

        _converter = DocumentConverter(
            format_options={
                InputFormat.IMAGE: ImageFormatOption(pipeline_options=opts),
                InputFormat.PDF: PdfFormatOption(pipeline_options=opts),
                # other formats use defaults
            }
        )

    return _converter

def extract_content(file_path: str) -> dict:
    """
    Docs-only extraction (no OCR).
    Returns both:
      - markdown: for LLM + chunking
      - metadata: for page/table/heading provenance (store in Mongo)
    """
    # logger.info(f"📄 Docling extracting from: {file_path}")

    try:
        result = get_converter().convert(file_path)
        doc = result.document

        markdown = (doc.export_to_markdown() or "").strip()
        text = (doc.export_to_text() or "").strip() 
        metadata = doc.export_to_dict()

        if markdown:
            logger.info(f"✅ Extracted text preview: {markdown[:50]}...")
        elif not markdown and text:
            logger.info(f"✅ Extracted text (no markdown) preview: {text[:50]}...")
            markdown = text
        else:
            logger.warning("⚠️ Docling returned empty markdown.")

        return {
            "created": True,
            "markdown": markdown,
            "metadata": metadata,   # rich structure for citations later
        }

    except Exception as e:
        msg = str(e)

        # ✅ fallback only on “not allowed” / unsupported formats
        if "File format not allowed" in msg or "does not match any" in msg:
            logger.warning(f"Docling unsupported format, using plain-text fallback: {msg}")
            return extract_plain_text(file_path)
        
        logger.exception(f"❌ Docling extraction failed: {e}")
        return {"created": False, "markdown": "", "metadata": None}
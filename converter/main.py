import io
import base64
import mimetypes
import os
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
import uvicorn

try:
    from markitdown import MarkItDown
except ImportError:
    MarkItDown = None

try:
    from docling.document_converter import DocumentConverter
except ImportError:
    DocumentConverter = None


app = FastAPI(title="FastExams Converter", version="0.1.0")

LOG_DEBUG = os.environ.get("CONVERTER_DEBUG", "").lower() in ("1", "true", "yes")


def extract_images_from_markdown(markdown_text: str) -> list[dict]:
    """
    Parse markdown for embedded images and base64 encode them.
    For now, return empty list as MarkItDown doesn't embed images in markdown.
    Images are handled separately per the blueprint.
    """
    # Stub: images handled by Next.js app per blueprint. Keep for future use.
    return []


def convert_pdf_or_pptx(file_bytes: bytes, file_type: str) -> dict:
    """
    Convert PDF or PPTX to markdown.
    Try MarkItDown first; if PDF text is sparse, use Docling.
    """
    if not MarkItDown:
        raise HTTPException(status_code=500, detail="MarkItDown not installed")

    with TemporaryDirectory() as tmpdir:
        # Save file to temp location
        temp_path = Path(tmpdir) / f"upload.{file_type}"
        temp_path.write_bytes(file_bytes)

        # Try MarkItDown first
        try:
            converter = MarkItDown()
            result = converter.convert(str(temp_path))
            markdown = result.text_content

            # For PDFs, check if we need Docling (sparse content)
            if file_type.lower() == "pdf":
                lines = markdown.split("\n")
                page_count = markdown.count("\n---\n") + 1  # Rough estimate
                avg_chars_per_page = len(markdown) / max(page_count, 1)

                if avg_chars_per_page < 100 and DocumentConverter:
                    # Escalate to Docling
                    try:
                        converter_doc = DocumentConverter()
                        result_doc = converter_doc.convert(str(temp_path))
                        markdown = result_doc.document.export_to_markdown()
                        return {
                            "markdown": markdown,
                            "images": [],
                            "converter_used": "docling",
                        }
                    except Exception as e:
                        # Docling was tried but failed; return MarkItDown result with warning flag
                        return {
                            "markdown": markdown,
                            "images": [],
                            "converter_used": "markitdown_docling_failed",
                            "docling_error": str(e),
                        }

            return {
                "markdown": markdown,
                "images": [],
                "converter_used": "markitdown",
            }
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Conversion failed: {str(e)}")


@app.post("/convert")
async def convert(
    file: UploadFile = File(...),
    file_type: str = Form(...),
):
    """
    Convert PDF or PPTX file to markdown.

    file_type: 'pdf' or 'pptx'
    """
    try:
        if LOG_DEBUG:
            print(f"[converter] /convert: file={file.filename}, file_type={file_type}", flush=True)

        if file_type not in ["pdf", "pptx"]:
            err = f"file_type must be 'pdf' or 'pptx', got: {file_type}"
            if LOG_DEBUG:
                print(f"[converter] validation: {err}", flush=True)
            raise HTTPException(status_code=400, detail=err)

        file_bytes = await file.read()

        if not file_bytes:
            raise HTTPException(status_code=400, detail="File is empty")

        result = convert_pdf_or_pptx(file_bytes, file_type)

        return JSONResponse(result)
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"ERROR in /convert: {e}", flush=True)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health():
    return {"status": "ok", "markitdown": MarkItDown is not None, "docling": DocumentConverter is not None}


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)

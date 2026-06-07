# FastExams Converter Microservice

Python FastAPI microservice for converting PDFs and PowerPoint files to markdown.

## Setup

### Prerequisites
- Python 3.11+
- `brew install libmagic` (macOS only, required for python-magic)

### Installation

```bash
cd converter
python3.11 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

pip install markitdown docling fastapi uvicorn python-magic python-multipart
```

## Running

```bash
source venv/bin/activate
uvicorn main:app --port 8001 --reload
```

Server starts at `http://localhost:8001`

## API

### POST /convert

Converts a PDF or PPTX file to markdown.

**Request:**
```bash
curl -X POST http://localhost:8001/convert \
  -F "file=@document.pdf" \
  -F "file_type=pdf"
```

**Response:**
```json
{
  "markdown": "# Title\n\nContent...",
  "images": [],
  "converter_used": "markitdown"
}
```

**Parameters:**
- `file` (File): The uploaded PDF or PPTX file
- `file_type` (string): Either `"pdf"` or `"pptx"`

**Returns:**
- `markdown` (string): Extracted content as markdown
- `images` (array): List of extracted images (currently empty, handled separately)
- `converter_used` (string): Which converter was used ("markitdown" or "docling")

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "markitdown": true,
  "docling": true
}
```

## How It Works

1. **PPTX files**: Always use MarkItDown (excellent slide structure preservation)
2. **PDF files**: Try MarkItDown first; if average text per page < 100 chars, escalate to Docling
3. **Output**: Markdown with heading hierarchy preserved
4. **Images**: Extracted separately (stored in Supabase Storage by the Next.js app)

## Notes

- Docling downloads ~1GB of ML models on first complex PDF — this happens automatically
- MarkItDown is fast and works well for clean digital PDFs
- Both converters preserve section hierarchies via markdown headings

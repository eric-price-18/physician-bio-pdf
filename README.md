```markdown
# Physician Bio PDF (Refactor)

Paste the text from the physician's Johns Hopkins (or other) page, upload a photo, preview a printable layout, and export a multi-page PDF — all client-side.

This refactor splits the previous single-file HTML into:
- index.html — UI and markup
- styles.css — layout and print styles
- script.js — preview logic and PDF export (uses html2pdf)

Features
- Paste bio text (preserves line breaks)
- Upload a profile photo
- Preview rendering with optional page guides showing where pages will break
- Export to PDF client-side using html2pdf (no server required)
- Page size and margin options

How to use
1. Open `index.html` in a modern browser (Chrome, Edge, Firefox).
2. Paste the bio into the "Paste bio text" textarea.
3. Upload a photo.
4. Click "Update Preview" to reflow.
5. Click "Export PDF" to download a printable multi-page PDF.

Notes & considerations
- This implementation uses html2pdf.js (html2canvas + jsPDF). Some complex styling or external fonts may shift page breaks vs. server-side PDF renderers.
- If you need exact print fidelity (fonts, professional layout), consider server-side rendering (wkhtmltopdf, headless Chrome) or generating PDFs from a template.
- Accessibility: basic form labeling is included; further improvements can be made for keyboard navigation.
```
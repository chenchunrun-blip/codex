import { db } from "@/lib/db"
import { marked } from 'marked'

export async function exportToMarkdown(fileId: string): Promise<{ filename: string; content: string }> {
  const file = await db.file.findUnique({
    where: { id: fileId }
  })

  if (!file) {
    throw new Error("File not found")
  }

  return {
    filename: `${file.name}.md`,
    content: file.content
  }
}

export async function exportToHTML(fileId: string, forPDF = false): Promise<{ filename: string; content: string }> {
  const file = await db.file.findUnique({
    where: { id: fileId }
  })

  if (!file) {
    throw new Error("File not found")
  }

  // Configure marked options
  marked.setOptions({
    gfm: true,
    breaks: true
  })

  // Convert markdown to HTML
  const htmlContent = await marked(file.content)

  // Create complete HTML document
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${file.name}</title>
  ${forPDF ? `
  <style media="print">
    @page {
      margin: 2cm;
      size: A4;
    }
    body {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .no-print {
      display: none !important;
    }
  </style>
  ` : ''}
  <style>
    * {
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.7;
      max-width: 900px;
      margin: 0 auto;
      padding: 40px 20px;
      color: #333;
      background: #fff;
    }

    h1, h2, h3, h4, h5, h6 {
      margin-top: 2em;
      margin-bottom: 1em;
      font-weight: 600;
      line-height: 1.3;
    }

    h1 {
      font-size: 2.5em;
      border-bottom: 2px solid #eee;
      padding-bottom: 0.3em;
      margin-top: 0;
    }

    h2 {
      font-size: 2em;
      border-bottom: 1px solid #eee;
      padding-bottom: 0.3em;
    }

    h3 {
      font-size: 1.5em;
    }

    h4 {
      font-size: 1.25em;
    }

    p {
      margin: 1em 0;
    }

    a {
      color: #0366d6;
      text-decoration: none;
    }

    a:hover {
      text-decoration: underline;
    }

    code {
      background: #f6f8fa;
      padding: 0.2em 0.4em;
      border-radius: 3px;
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 85%;
    }

    pre {
      background: #f6f8fa;
      padding: 16px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 1em 0;
    }

    pre code {
      background: transparent;
      padding: 0;
      font-size: 100%;
    }

    blockquote {
      border-left: 4px solid #dfe2e5;
      padding-left: 16px;
      color: #6a737d;
      margin: 1em 0;
    }

    ul, ol {
      padding-left: 2em;
      margin: 1em 0;
    }

    li {
      margin: 0.5em 0;
    }

    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1em 0;
    }

    table th,
    table td {
      border: 1px solid #dfe2e5;
      padding: 8px 13px;
    }

    table th {
      background: #f6f8fa;
      font-weight: 600;
    }

    table tr:nth-child(even) {
      background: #f6f8fa;
    }

    hr {
      border: none;
      border-top: 2px solid #eee;
      margin: 2em 0;
    }

    img {
      max-width: 100%;
      height: auto;
    }

    ${forPDF ? `
    .print-instructions {
      background: #f0f7ff;
      border: 1px solid #b6d4fe;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
      text-align: center;
    }

    .print-instructions h2 {
      margin-top: 0;
      color: #0366d6;
    }

    .print-instructions p {
      margin: 0.5em 0;
    }

    .print-btn {
      display: inline-block;
      background: #0366d6;
      color: white;
      padding: 10px 20px;
      border-radius: 6px;
      text-decoration: none;
      font-weight: 600;
      margin-top: 10px;
    }

    .print-btn:hover {
      background: #0256c7;
      text-decoration: none;
    }
    ` : ''}
  </style>
</head>
<body>
  ${forPDF ? `
  <div class="print-instructions no-print">
    <h2>📄 Export to PDF</h2>
    <p>To save this document as a PDF:</p>
    <ol style="text-align: left; display: inline-block;">
      <li>Click the "Save as PDF" button below</li>
      <li>In the print dialog, select "Save as PDF" as the destination</li>
      <li>Click Save to download your PDF file</li>
    </ol>
    <button class="print-btn" onclick="window.print()">💾 Save as PDF</button>
  </div>
  ` : ''}
  <main>
    ${htmlContent}
  </main>
  ${forPDF ? `
  <div class="no-print" style="margin-top: 40px; text-align: center; color: #666;">
    <p>Document exported from MarqDex</p>
  </div>
  ` : ''}
</body>
</html>
  `

  return {
    filename: `${file.name}.html`,
    content: html
  }
}

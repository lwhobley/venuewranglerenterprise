import os
import re
import subprocess
from pathlib import Path
import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
import markdown

WORKSPACE_DIR = Path(__file__).resolve().parent.parent
DOCS_DIR = WORKSPACE_DIR / "docs"
MD_FILE = DOCS_DIR / "operator-guidebook.md"
DOCX_FILE = DOCS_DIR / "Venue_Wrangler_Operator_Guidebook.docx"
PDF_FILE = DOCS_DIR / "Venue_Wrangler_Operator_Guidebook.pdf"
HTML_TEMP_FILE = DOCS_DIR / "temp_guidebook.html"

# Color constants
BRAND_DARK = RGBColor(7, 68, 38)     # #074426 Deep Venue Green
BRAND_GOLD = RGBColor(138, 93, 35)   # #8A5D23 Warm Amber
TEXT_DARK = RGBColor(30, 41, 59)     # #1E293B Slate 800
GRAY_BG = "F1F5F9"

def set_cell_background(cell, fill_hex):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), fill_hex)
    tc_pr.append(shd)

def set_cell_margins(cell, top=100, bottom=100, left=150, right=150):
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_mar = OxmlElement('w:tcMar')
    for m, val in [('top', top), ('bottom', bottom), ('left', left), ('right', right)]:
        node = OxmlElement(f'w:{m}')
        node.set(qn('w:w'), str(val))
        node.set(qn('w:type'), 'dxa')
        tc_mar.append(node)
    tc_pr.append(tc_mar)

def create_docx(md_content, output_path):
    print("Building DOCX document...")
    doc = docx.Document()
    
    # Page setup - 0.8 inch margins
    sections = doc.sections
    for s in sections:
        s.top_margin = Inches(0.8)
        s.bottom_margin = Inches(0.8)
        s.left_margin = Inches(0.8)
        s.right_margin = Inches(0.8)

    # Base Styles
    normal_style = doc.styles['Normal']
    normal_style.font.name = 'Calibri'
    normal_style.font.size = Pt(11)
    normal_style.font.color.rgb = TEXT_DARK
    normal_style.paragraph_format.line_spacing = 1.2
    normal_style.paragraph_format.space_after = Pt(6)

    lines = md_content.split('\n')
    i = 0
    in_code_block = False
    code_lines = []

    while i < len(lines):
        line = lines[i]

        # Handle code blocks
        if line.strip().startswith('```'):
            if in_code_block:
                # End code block
                table = doc.add_table(rows=1, cols=1)
                table.alignment = WD_TABLE_ALIGNMENT.CENTER
                table.autofit = False
                cell = table.cell(0, 0)
                cell.width = Inches(6.8)
                set_cell_background(cell, "F8FAFC")
                set_cell_margins(cell, top=120, bottom=120, left=180, right=180)
                p = cell.paragraphs[0]
                p.paragraph_format.space_after = Pt(0)
                p.paragraph_format.line_spacing = 1.15
                code_text = '\n'.join(code_lines)
                run = p.add_run(code_text)
                run.font.name = 'Consolas'
                run.font.size = Pt(9.5)
                run.font.color.rgb = RGBColor(51, 65, 85)
                doc.add_paragraph() # Spacing
                code_lines = []
                in_code_block = False
            else:
                in_code_block = True
                code_lines = []
            i += 1
            continue

        if in_code_block:
            code_lines.append(line)
            i += 1
            continue

        # Handle Markdown Tables
        if '|' in line and i + 1 < len(lines) and re.match(r'^\s*\|?\s*[-:]+[-| :]*\|?\s*$', lines[i+1]):
            table_lines = [line]
            i += 2 # Skip header and separator
            while i < len(lines) and '|' in lines[i] and lines[i].strip():
                table_lines.append(lines[i])
                i += 1

            headers = [c.strip() for c in table_lines[0].strip().strip('|').split('|')]
            rows = []
            for r in table_lines[1:]:
                rows.append([c.strip() for c in r.strip().strip('|').split('|')])

            table = doc.add_table(rows=len(rows) + 1, cols=len(headers))
            table.alignment = WD_TABLE_ALIGNMENT.CENTER
            table.autofit = True

            # Header row
            hdr_cells = table.rows[0].cells
            for col_idx, h in enumerate(headers):
                hdr_cells[col_idx].text = h
                set_cell_background(hdr_cells[col_idx], "074426")
                set_cell_margins(hdr_cells[col_idx], top=100, bottom=100, left=120, right=120)
                p = hdr_cells[col_idx].paragraphs[0]
                p.paragraph_format.space_after = Pt(2)
                for run in p.runs:
                    run.font.bold = True
                    run.font.color.rgb = RGBColor(255, 255, 255)
                    run.font.size = Pt(10)

            # Data rows
            for row_idx, row_data in enumerate(rows):
                row_cells = table.rows[row_idx + 1].cells
                bg_color = "FFFFFF" if row_idx % 2 == 0 else "F8FAFC"
                for col_idx in range(len(headers)):
                    val = row_data[col_idx] if col_idx < len(row_data) else ""
                    # strip markdown bold from table cells
                    clean_val = re.sub(r'\*\*(.*?)\*\*', r'\1', val)
                    row_cells[col_idx].text = clean_val
                    set_cell_background(row_cells[col_idx], bg_color)
                    set_cell_margins(row_cells[col_idx], top=80, bottom=80, left=120, right=120)
                    p = row_cells[col_idx].paragraphs[0]
                    p.paragraph_format.space_after = Pt(2)
                    for run in p.runs:
                        run.font.size = Pt(9.5)
                        run.font.color.rgb = TEXT_DARK
                        if col_idx == 0:
                            run.font.bold = True

            doc.add_paragraph() # Spacing
            continue

        # Blank line
        if not line.strip():
            i += 1
            continue

        # Horizontal Rule
        if line.strip() in ('---', '***', '___'):
            p = doc.add_paragraph()
            p.paragraph_format.space_after = Pt(12)
            i += 1
            continue

        # Heading 1
        if line.startswith('# '):
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(18)
            p.paragraph_format.space_after = Pt(8)
            run = p.add_run(line[2:].strip())
            run.font.size = Pt(22)
            run.font.bold = True
            run.font.color.rgb = BRAND_DARK
            i += 1
            continue

        # Heading 2
        if line.startswith('## '):
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(16)
            p.paragraph_format.space_after = Pt(6)
            run = p.add_run(line[3:].strip())
            run.font.size = Pt(15)
            run.font.bold = True
            run.font.color.rgb = BRAND_DARK
            i += 1
            continue

        # Heading 3
        if line.startswith('### '):
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(12)
            p.paragraph_format.space_after = Pt(4)
            run = p.add_run(line[4:].strip())
            run.font.size = Pt(12.5)
            run.font.bold = True
            run.font.color.rgb = BRAND_GOLD
            i += 1
            continue

        # Bullet List
        if line.strip().startswith('* ') or line.strip().startswith('- '):
            indent_level = (len(line) - len(line.lstrip())) // 2
            text = line.strip()[2:].strip()
            p = doc.add_paragraph(style='List Bullet')
            p.paragraph_format.left_indent = Inches(0.25 * (indent_level + 1))
            p.paragraph_format.space_after = Pt(3)
            parse_inline_formatting(p, text)
            i += 1
            continue

        # Numbered List
        num_match = re.match(r'^\s*(\d+)\.\s+(.*)$', line)
        if num_match:
            text = num_match.group(2).strip()
            p = doc.add_paragraph(style='List Number')
            p.paragraph_format.space_after = Pt(3)
            parse_inline_formatting(p, text)
            i += 1
            continue

        # Regular Paragraph
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(6)
        parse_inline_formatting(p, line.strip())
        i += 1

    doc.save(str(output_path))
    print(f"DOCX created successfully at: {output_path}")

def parse_inline_formatting(paragraph, text):
    """Parses bold, italic, code, and links in a line and adds runs to paragraph."""
    # Pattern for **bold**, *italic*, `code`
    tokens = re.split(r'(\*\*.*?\*\*|\*.*?\*|`.*?`)', text)
    for token in tokens:
        if not token:
            continue
        if token.startswith('**') and token.endswith('**'):
            run = paragraph.add_run(token[2:-2])
            run.bold = True
            run.font.color.rgb = TEXT_DARK
        elif token.startswith('*') and token.endswith('*'):
            run = paragraph.add_run(token[1:-1])
            run.italic = True
        elif token.startswith('`') and token.endswith('`'):
            run = paragraph.add_run(token[1:-1])
            run.font.name = 'Consolas'
            run.font.size = Pt(9.5)
            run.font.color.rgb = RGBColor(180, 83, 9)
        else:
            paragraph.add_run(token)

def create_pdf(md_content, output_path):
    print("Building PDF document via HTML & Headless Chrome...")
    # Convert markdown to html with extensions
    html_body = markdown.markdown(md_content, extensions=['tables', 'fenced_code', 'nl2br'])
    
    html_template = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Venue Wrangler Enterprise · Operator's Field Guide</title>
<style>
  @page {{
    size: A4 portrait;
    margin: 18mm 16mm 18mm 16mm;
    @bottom-right {{
      content: counter(page);
    }}
  }}
  * {{
    box-sizing: border-box;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #1E293B;
    line-height: 1.5;
    background: #FFFFFF;
    margin: 0;
    padding: 0;
    font-size: 10pt;
  }}
  .cover-header {{
    background: linear-gradient(135deg, #074426 0%, #0F683D 100%);
    color: white;
    padding: 24px 28px;
    border-radius: 8px;
    margin-bottom: 24px;
  }}
  .cover-header h1 {{
    font-size: 22pt;
    font-weight: 800;
    margin: 0 0 6px 0;
    color: #FFFFFF;
    letter-spacing: -0.5px;
  }}
  .cover-header p {{
    font-size: 11pt;
    font-weight: 500;
    margin: 0;
    color: #E2E8F0;
  }}
  .badge {{
    display: inline-block;
    background: #8A5D23;
    color: white;
    font-size: 8pt;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }}
  h1 {{
    display: none; /* replaced by cover header */
  }}
  h2 {{
    color: #074426;
    font-size: 13.5pt;
    font-weight: 700;
    border-bottom: 1.5px solid #E2E8F0;
    padding-bottom: 6px;
    margin-top: 24px;
    margin-bottom: 10px;
    page-break-after: avoid;
  }}
  h3 {{
    color: #8A5D23;
    font-size: 11pt;
    font-weight: 700;
    margin-top: 14px;
    margin-bottom: 6px;
    page-break-after: avoid;
  }}
  p {{
    margin: 0 0 8px 0;
  }}
  ul, ol {{
    margin: 0 0 10px 0;
    padding-left: 20px;
  }}
  li {{
    margin-bottom: 4px;
  }}
  code {{
    font-family: "Cascadia Code", Consolas, Monaco, monospace;
    font-size: 8.5pt;
    background: #F1F5F9;
    color: #0F172A;
    padding: 2px 5px;
    border-radius: 4px;
    border: 1px solid #E2E8F0;
  }}
  pre {{
    background: #0F172A;
    color: #F8FAFC;
    padding: 12px 14px;
    border-radius: 6px;
    font-family: "Cascadia Code", Consolas, Monaco, monospace;
    font-size: 8.5pt;
    line-height: 1.4;
    overflow-x: auto;
    page-break-inside: avoid;
    margin: 8px 0 14px 0;
  }}
  pre code {{
    background: transparent;
    color: inherit;
    padding: 0;
    border: none;
  }}
  table {{
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0 16px 0;
    font-size: 9pt;
    page-break-inside: avoid;
  }}
  th {{
    background: #074426;
    color: #FFFFFF;
    font-weight: 700;
    text-align: left;
    padding: 8px 10px;
    border: 1px solid #074426;
  }}
  td {{
    padding: 7px 10px;
    border: 1px solid #E2E8F0;
    vertical-align: top;
  }}
  tr:nth-child(even) td {{
    background: #F8FAFC;
  }}
  hr {{
    border: none;
    border-top: 1px solid #E2E8F0;
    margin: 18px 0;
  }}
  .footer-note {{
    text-align: center;
    font-size: 8pt;
    color: #94A3B8;
    margin-top: 30px;
    border-top: 1px solid #E2E8F0;
    padding-top: 10px;
  }}
</style>
</head>
<body>
  <div class="cover-header">
    <div class="badge">Official Venue Operations Guide</div>
    <h1>Venue Wrangler Enterprise</h1>
    <p>The Operator's Field Guide: Step-by-Step Manual for GMs, Directors, Supervisors, and Staff</p>
  </div>

  {html_body}

  <div class="footer-note">
    VENUE WRANGLER ENTERPRISE · CONFIDENTIAL &amp; PROPRIETARY OPERATIONS GUIDE
  </div>
</body>
</html>"""

    HTML_TEMP_FILE.write_text(html_template, encoding='utf-8')
    
    # Chrome binary path
    chrome_path = Path("C:/Program Files/Google/Chrome/Application/chrome.exe")
    if not chrome_path.exists():
        chrome_path = Path("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe")
    
    cmd = [
        str(chrome_path),
        "--headless",
        "--disable-gpu",
        "--run-all-compositor-stages-before-draw",
        f"--print-to-pdf={output_path}",
        "--no-pdf-header-footer",
        str(HTML_TEMP_FILE)
    ]
    
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode == 0:
        print(f"PDF created successfully at: {output_path}")
    else:
        print(f"Chrome export error: {res.stderr}")
    
    if HTML_TEMP_FILE.exists():
        HTML_TEMP_FILE.unlink()

def main():
    if not MD_FILE.exists():
        print(f"Error: {MD_FILE} does not exist!")
        return
    
    md_content = MD_FILE.read_text(encoding='utf-8')
    create_docx(md_content, DOCX_FILE)
    create_pdf(md_content, PDF_FILE)
    print("Done generating export files!")

if __name__ == "__main__":
    main()

const fs = require('fs');
const path = require('path');
const db = require('../src/config/db');
const { execSync } = require('child_process');

async function exportUsers() {
  console.log('[Export] Fetching all users from database...');
  try {
    const res = await db.query(`
      SELECT 
        u.id, 
        u.guid, 
        u.name, 
        u.email, 
        u.phone, 
        u.role, 
        COALESCE(u.user_type, u.role, 'RESIDENT') as user_type, 
        u.residency_status, 
        u.registration_status, 
        u.flat_info, 
        u.department_id,
        d.name as department_name,
        u.created_at
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      ORDER BY u.id ASC
    `);

    console.log(`[Export] Fetched ${res.rows.length} users.`);

    // 1. Write JSON intermediate
    const jsonPath = path.join(__dirname, 'users_temp.json');
    fs.writeFileSync(jsonPath, JSON.stringify(res.rows, null, 2), 'utf8');

    // 2. Python script to convert to Excel (.xlsx) and CSV
    const pyScript = `
import json
import csv
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

with open(r'${jsonPath.replace(/\\/g, '\\\\')}', 'r', encoding='utf-8') as f:
    users = json.load(f)

if not users:
    print('No users found.')
    exit(0)

headers = list(users[0].keys())

# CSV Export
csv_file = r'c:\\RD\\VM - Copy\\users_export.csv'
with open(csv_file, 'w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=headers)
    writer.writeheader()
    writer.writerows(users)
print(f'CSV exported to: {csv_file}')

# XLSX Export with formatting
xlsx_file = r'c:\\RD\\VM - Copy\\users_export.xlsx'
wb = openpyxl.Workbook()
ws = wb.active
ws.title = 'VMS Users'

header_fill = PatternFill(start_color='1F4E79', end_color='1F4E79', fill_type='solid')
header_font = Font(name='Calibri', size=11, bold=True, color='FFFFFF')
border_thin = Border(
    left=Side(style='thin', color='D9D9D9'),
    right=Side(style='thin', color='D9D9D9'),
    top=Side(style='thin', color='D9D9D9'),
    bottom=Side(style='thin', color='D9D9D9')
)

ws.append(headers)
for col_num in range(1, len(headers) + 1):
    cell = ws.cell(row=1, column=col_num)
    cell.fill = header_fill
    cell.font = header_font
    cell.alignment = Alignment(horizontal='center', vertical='center')

for row_idx, user in enumerate(users, start=2):
    row_data = [str(user.get(h, '')) if user.get(h) is not None else '' for h in headers]
    ws.append(row_data)
    for col_idx in range(1, len(headers) + 1):
        c = ws.cell(row=row_idx, column=col_idx)
        c.border = border_thin
        if row_idx % 2 == 0:
            c.fill = PatternFill(start_color='F2F4F7', end_color='F2F4F7', fill_type='solid')

# Auto-adjust column widths
for col in ws.columns:
    max_len = max(len(str(cell.value or '')) for cell in col)
    col_letter = openpyxl.utils.get_column_letter(col[0].column)
    ws.column_dimensions[col_letter].width = max(max_len + 3, 12)

wb.save(xlsx_file)
print(f'Excel exported to: {xlsx_file}')
`;

    fs.writeFileSync(path.join(__dirname, 'export_to_excel.py'), pyScript, 'utf8');
    execSync('python export_to_excel.py', { cwd: __dirname, stdio: 'inherit' });

    // Cleanup temp json and py script
    if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
    if (fs.existsSync(path.join(__dirname, 'export_to_excel.py'))) fs.unlinkSync(path.join(__dirname, 'export_to_excel.py'));

    console.log('[Export] Finished successfully!');
    process.exit(0);
  } catch (err) {
    console.error('[Export Error]:', err);
    process.exit(1);
  }
}

exportUsers();

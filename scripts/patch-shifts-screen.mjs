import fs from 'fs';

const filePath = 'd:/CRM/enterprise-platform/packages/features/hrm/src/lib/screens/shifts-screen.tsx';
let code = fs.readFileSync(filePath, 'utf8');

// Replace old hardcoded options in cell popover
const oldOptionPattern = /<option value="CA-HC">CA-HC[\s\S]*?<\/select>/;
const replacement = `{shifts.map((s) => (
                                                        <option key={s.id} value={s.code}>
                                                          [{s.code}] {s.name} ({s.startTime?.slice(0, 5)} - {s.endTime?.slice(0, 5)})
                                                        </option>
                                                      ))}
                                                    </select>`;

if (oldOptionPattern.test(code)) {
  code = code.replace(oldOptionPattern, replacement);
  console.log('Replaced cell popover options!');
}

// Replace second occurrence in Company Config Modal
if (oldOptionPattern.test(code)) {
  code = code.replace(oldOptionPattern, replacement);
  console.log('Replaced company modal options!');
}

fs.writeFileSync(filePath, code, 'utf8');
console.log('Done!');

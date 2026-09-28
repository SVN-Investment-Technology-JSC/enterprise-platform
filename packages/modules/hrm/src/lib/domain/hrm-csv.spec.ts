import { hrmCsv } from './hrm-csv';
describe('HRM spreadsheet export', () => {
  it('escapes quotes, multiline fields and formula prefixes after whitespace', () => {
    expect(
      hrmCsv([['  =IMPORTDATA("url")', 'line\n2', 'name,"quoted"', 1250]]),
    ).toBe(
      '\uFEFF"\'  =IMPORTDATA(""url"")","line\n2","name,""quoted""","1250"',
    );
  });
});

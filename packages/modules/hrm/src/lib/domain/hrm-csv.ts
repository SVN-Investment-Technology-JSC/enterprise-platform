/** Escape spreadsheet control prefixes as well as CSV delimiters. */
export function hrmCsv(rows: readonly (readonly unknown[])[]): string {
  return (
    '\uFEFF' +
    rows
      .map((row) =>
        row
          .map((value) => {
            const text = String(value ?? '');
            const leading = text
              .split('')
              .find(
                (char) => char.charCodeAt(0) > 32 && char.trim().length > 0,
              );
            const safe =
              leading && '=+@-'.includes(leading) ? `'${text}` : text;
            return `"${safe.replace(/"/g, '""')}"`;
          })
          .join(','),
      )
      .join('\r\n')
  );
}

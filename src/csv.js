export function downloadCsv(filename, headers, rows) {
  const escape = value => {
    const text = value == null ? '' : String(value);
    const safe = /^[=+@\-\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const content = [headers, ...rows].map(row => row.map(escape).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`\ufeff${content}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

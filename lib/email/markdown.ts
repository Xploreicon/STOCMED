import { escapeEmailHtml } from '@/lib/email/template'

function inlineMarkdown(value: string) {
  return escapeEmailHtml(value)
    .replace(/\[([^\]]+)\]\(((?:https:\/\/|\/)[^)\s]+)\)/g, '<a href="$2" style="color:#087f5b;text-decoration:underline">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
}

export function markdownToEmailHtml(markdown: string) {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n')
  const output: string[] = []
  let listOpen = false

  const closeList = () => {
    if (listOpen) output.push('</ul>')
    listOpen = false
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      closeList()
      continue
    }
    if (line.startsWith('### ')) {
      closeList()
      output.push(`<h3 style="margin:22px 0 8px;font-size:17px">${inlineMarkdown(line.slice(4))}</h3>`)
    } else if (line.startsWith('## ')) {
      closeList()
      output.push(`<h2 style="margin:24px 0 10px;font-size:20px">${inlineMarkdown(line.slice(3))}</h2>`)
    } else if (/^[-*]\s+/.test(line)) {
      if (!listOpen) output.push('<ul style="margin:12px 0;padding-left:22px">')
      listOpen = true
      output.push(`<li style="margin:6px 0">${inlineMarkdown(line.replace(/^[-*]\s+/, ''))}</li>`)
    } else {
      closeList()
      output.push(`<p style="margin:0 0 14px">${inlineMarkdown(line)}</p>`)
    }
  }
  closeList()
  return output.join('')
}

export function markdownToText(markdown: string) {
  return markdown
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/^#{2,3}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .trim()
}

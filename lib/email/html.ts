import sanitizeHtml from 'sanitize-html'

const allowedStyles = {
  '*': {
    color: [/^#[0-9a-f]{3,8}$/i, /^rgb\(/i, /^[a-z]+$/i],
    'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgb\(/i, /^[a-z]+$/i],
    'font-size': [/^\d+(px|em|rem|%)$/],
    'font-weight': [/^(normal|bold|[1-9]00)$/],
    'font-style': [/^(normal|italic)$/],
    'line-height': [/^\d+(\.\d+)?(px|em|rem|%)?$/],
    'text-align': [/^(left|center|right)$/],
    'text-decoration': [/^(none|underline)$/],
    margin: [/^[\d .%-]+(px|em|rem|%)?$/],
    'margin-top': [/^\d+(px|em|rem|%)$/],
    'margin-right': [/^\d+(px|em|rem|%)$/],
    'margin-bottom': [/^\d+(px|em|rem|%)$/],
    'margin-left': [/^\d+(px|em|rem|%)$/],
    padding: [/^[\d .%-]+(px|em|rem|%)?$/],
    'padding-top': [/^\d+(px|em|rem|%)$/],
    'padding-right': [/^\d+(px|em|rem|%)$/],
    'padding-bottom': [/^\d+(px|em|rem|%)$/],
    'padding-left': [/^\d+(px|em|rem|%)$/],
  },
}

export function sanitizeAdminEmailHtml(value: string) {
  return sanitizeHtml(value, {
    allowedTags: [
      'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'h1', 'h2', 'h3',
      'h4', 'ul', 'ol', 'li', 'blockquote', 'hr', 'table', 'thead', 'tbody',
      'tr', 'th', 'td', 'div', 'span', 'img',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel', 'style'],
      img: ['src', 'alt', 'title', 'width', 'height', 'style'],
      table: ['width', 'cellpadding', 'cellspacing', 'role', 'style'],
      th: ['colspan', 'rowspan', 'scope', 'style'],
      td: ['colspan', 'rowspan', 'style'],
      '*': ['style'],
    },
    allowedSchemes: ['https', 'mailto'],
    allowedSchemesByTag: { img: ['https'] },
    allowedStyles,
    allowProtocolRelative: false,
    enforceHtmlBoundary: true,
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', {
        target: '_blank',
        rel: 'noopener noreferrer',
      }, true),
    },
  })
}

export function emailHtmlToText(value: string) {
  return sanitizeHtml(value, {
    allowedTags: [],
    allowedAttributes: {},
    textFilter: text => text.replace(/\s+/g, ' '),
  })
    .replace(/\s{2,}/g, ' ')
    .trim()
}

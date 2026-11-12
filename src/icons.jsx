import React from 'react'

const PATHS = {
  book: [
    'M4.5 5.5A2.5 2.5 0 0 1 7 3h13v18H7a2.5 2.5 0 0 1-2.5-2.5z',
    'M7 3v15',
    'M10 8h6',
    'M10 12h4',
  ],
  folder: [
    'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z',
  ],
  left: ['M15 5l-7 7 7 7'],
  right: ['M9 5l7 7-7 7'],
  down: ['M6 9l6 6 6-6'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  fit: ['M4 9V5h4', 'M20 9V5h-4', 'M4 15v4h4', 'M20 15v4h-4'],
  languages: [
    'M3 6h9',
    'M7.5 4v2',
    'M5 6c.6 4 3.2 6.7 7 8',
    'M10 6c-.5 3.2-2.4 5.5-5 7',
    'M13 20l4-10 4 10',
    'M14.6 16h4.8',
  ],
  sparkle: [
    'M12 3l1.6 5.2L19 10l-5.4 1.8L12 17l-1.6-5.2L5 10l5.4-1.8z',
    'M19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z',
  ],
  download: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
  settings: [
    'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z',
    'M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z',
  ],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  panelLeft: ['M4 4h16v16H4z', 'M9 4v16'],
  panelRight: ['M4 4h16v16H4z', 'M15 4v16'],
  copy: ['M9 9h10v10H9z', 'M5 15H4V4h11v1'],
  stop: ['M7 7h10v10H7z'],
  alert: ['M12 4l9 16H3z', 'M12 9v4', 'M12 17h.01'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  list: ['M8 6h12', 'M8 12h12', 'M8 18h12', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'],
  file: ['M6 3h8l5 5v13H6z', 'M14 3v5h5'],
  refresh: ['M20 7v5h-5', 'M4 17v-5h5', 'M6.1 8a7 7 0 0 1 11.5-1L20 12', 'M4 12l2.4 5a7 7 0 0 0 11.5-1'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M16 16l4.5 4.5'],
  quote: ['M7 7h4v4H7z', 'M13 7h4v4h-4z', 'M7 11v4a2 2 0 0 0 2 2', 'M13 11v4a2 2 0 0 0 2 2'],
  crop: ['M4 4h5', 'M15 4h5', 'M4 20h5', 'M15 20h5', 'M4 9v6', 'M20 9v6'],
  table: ['M4 5h16v14H4z', 'M4 10h16', 'M10 10v9', 'M15 10v9'],
  rotateLeft: ['M20 12a8 8 0 1 1-2.3-5.7', 'M20 4v5h-5'],
  rotateRight: ['M4 12a8 8 0 1 0 2.3-5.7', 'M4 4v5h5'],
  expand: ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'],
  columns: ['M4 4h16v16H4z', 'M12 4v16'],
}

export function Icon({ name, size = 18, strokeWidth = 1.7, style, ...rest }) {
  const paths = PATHS[name] ?? PATHS.file
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', flex: '0 0 auto', ...style }}
      {...rest}
    >
      {paths.map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  )
}

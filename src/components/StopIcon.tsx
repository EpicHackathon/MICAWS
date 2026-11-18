import React from 'react';

// Stop icon: solid circle with a rounded square cut out of the middle.
// The square is a real hole (no background), so the button color shows through it.
export default function StopIcon({ size = '1.15em', color = 'currentColor' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'inline-block', verticalAlign: '-0.2em', marginRight: '0.5em' }}
    >
      {/* evenodd: the inner square punches a hole through the circle */}
      <path
        fill={color}
        fillRule="evenodd"
        d="M12 1.5a10.5 10.5 0 1 1 0 21a10.5 10.5 0 0 1 0-21Z
           M9.6 8.4h4.8a1.2 1.2 0 0 1 1.2 1.2v4.8a1.2 1.2 0 0 1-1.2 1.2H9.6a1.2 1.2 0 0 1-1.2-1.2V9.6a1.2 1.2 0 0 1 1.2-1.2Z"
      />
    </svg>
  );
}

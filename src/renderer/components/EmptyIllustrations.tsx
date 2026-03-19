/**
 * Inline SVG illustrations for empty states.
 * Uses shared CSS variables so the empty-state palette adapts to light/dark mode.
 */

/** New-project card: a layered document with a sparkle */
export const IllustrationNewProject = ({ size = 64 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 80 80"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    {/* back doc */}
    <rect
      x="22"
      y="14"
      width="36"
      height="46"
      rx="6"
      fill="var(--empty-illustration-layer)"
    />
    {/* front doc */}
    <rect
      x="16"
      y="20"
      width="36"
      height="46"
      rx="6"
      fill="var(--empty-illustration-paper)"
      stroke="var(--empty-illustration-stroke)"
      strokeWidth="1.6"
    />
    {/* lines on front doc */}
    <rect
      x="24"
      y="32"
      width="20"
      height="2.4"
      rx="1.2"
      fill="var(--empty-illustration-line)"
    />
    <rect
      x="24"
      y="39"
      width="14"
      height="2.4"
      rx="1.2"
      fill="var(--empty-illustration-line)"
    />
    <rect
      x="24"
      y="46"
      width="18"
      height="2.4"
      rx="1.2"
      fill="var(--empty-illustration-line)"
    />
    {/* sparkle / plus star */}
    <circle cx="58" cy="24" r="11" fill="var(--empty-illustration-accent)" />
    <rect
      x="55.5"
      y="18.5"
      width="5"
      height="11"
      rx="2.5"
      fill="var(--empty-illustration-contrast)"
    />
    <rect
      x="52.5"
      y="21.5"
      width="11"
      height="5"
      rx="2.5"
      fill="var(--empty-illustration-contrast)"
    />
  </svg>
);

/** Empty file list: a folder with a dashed document */
export const IllustrationEmptyFiles = ({ size = 80 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 96 96"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    {/* folder body */}
    <rect
      x="12"
      y="30"
      width="72"
      height="48"
      rx="8"
      fill="var(--empty-illustration-layer)"
    />
    {/* folder tab */}
    <path
      d="M12 38c0-4.418 3.582-8 8-8h16l6 8H12z"
      fill="var(--empty-illustration-layer-strong)"
    />
    {/* dashed doc inside */}
    <rect
      x="32"
      y="42"
      width="32"
      height="28"
      rx="4"
      fill="var(--empty-illustration-paper)"
      stroke="var(--empty-illustration-stroke-strong)"
      strokeWidth="1.4"
      strokeDasharray="4 3"
    />
    {/* small lines */}
    <rect
      x="38"
      y="50"
      width="14"
      height="2"
      rx="1"
      fill="var(--empty-illustration-line)"
    />
    <rect
      x="38"
      y="56"
      width="10"
      height="2"
      rx="1"
      fill="var(--empty-illustration-line)"
    />
    <rect
      x="38"
      y="62"
      width="18"
      height="2"
      rx="1"
      fill="var(--empty-illustration-line)"
    />
  </svg>
);

/** Empty editor: a blank page with a pencil */
export const IllustrationEmptyEditor = ({ size = 96 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 96 96"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    {/* page */}
    <rect
      x="20"
      y="12"
      width="44"
      height="58"
      rx="6"
      fill="var(--empty-illustration-paper)"
      stroke="var(--empty-illustration-stroke)"
      strokeWidth="1.6"
    />
    {/* faint lines */}
    <rect
      x="28"
      y="26"
      width="24"
      height="2.2"
      rx="1.1"
      fill="var(--empty-illustration-line-soft)"
    />
    <rect
      x="28"
      y="33"
      width="18"
      height="2.2"
      rx="1.1"
      fill="var(--empty-illustration-line-soft)"
    />
    <rect
      x="28"
      y="40"
      width="22"
      height="2.2"
      rx="1.1"
      fill="var(--empty-illustration-line-soft)"
    />
    <rect
      x="28"
      y="47"
      width="16"
      height="2.2"
      rx="1.1"
      fill="var(--empty-illustration-line-soft)"
    />
    {/* pencil */}
    <g transform="translate(54,50) rotate(-45)">
      <rect
        x="0"
        y="0"
        width="7"
        height="30"
        rx="1.5"
        fill="var(--empty-illustration-accent)"
      />
      <rect
        x="0"
        y="0"
        width="7"
        height="6"
        rx="1.5"
        fill="var(--empty-illustration-accent-strong)"
      />
      <polygon
        points="0,30 3.5,38 7,30"
        fill="var(--empty-illustration-warm)"
      />
    </g>
  </svg>
);

/** Empty creation board: a storyboard card group with a play cue */
export const IllustrationEmptyCreationBoard = ({
  size = 168,
}: {
  size?: number;
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 176 176"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <rect
      x="20"
      y="30"
      width="136"
      height="98"
      rx="16"
      fill="var(--empty-illustration-panel)"
      stroke="var(--empty-illustration-stroke)"
      strokeWidth="1.8"
    />
    <rect
      x="20"
      y="30"
      width="136"
      height="18"
      rx="16"
      fill="var(--empty-illustration-layer)"
    />
    <circle cx="34" cy="39" r="2.8" fill="var(--empty-illustration-dot)" />
    <circle cx="44" cy="39" r="2.8" fill="var(--empty-illustration-dot)" />
    <circle cx="54" cy="39" r="2.8" fill="var(--empty-illustration-dot)" />

    <rect
      x="33"
      y="59"
      width="33"
      height="22"
      rx="6"
      fill="var(--empty-illustration-paper)"
      stroke="var(--empty-illustration-stroke)"
      strokeWidth="1.4"
    />
    <rect
      x="71.5"
      y="59"
      width="33"
      height="22"
      rx="6"
      fill="var(--empty-illustration-paper)"
      stroke="var(--empty-illustration-stroke)"
      strokeWidth="1.4"
    />
    <rect
      x="110"
      y="59"
      width="33"
      height="22"
      rx="6"
      fill="var(--empty-illustration-paper)"
      stroke="var(--empty-illustration-stroke)"
      strokeWidth="1.4"
    />

    <rect x="36.5" y="63" width="17" height="3" rx="1.5" fill="var(--empty-illustration-line)" />
    <rect x="36.5" y="69" width="12" height="3" rx="1.5" fill="var(--empty-illustration-line)" />
    <rect x="75" y="63" width="17" height="3" rx="1.5" fill="var(--empty-illustration-line)" />
    <rect x="75" y="69" width="12" height="3" rx="1.5" fill="var(--empty-illustration-line)" />
    <rect x="113.5" y="63" width="17" height="3" rx="1.5" fill="var(--empty-illustration-line)" />
    <rect x="113.5" y="69" width="12" height="3" rx="1.5" fill="var(--empty-illustration-line)" />

    <rect
      x="33"
      y="90"
      width="110"
      height="24"
      rx="8"
      fill="var(--empty-illustration-paper)"
      stroke="var(--empty-illustration-stroke)"
      strokeWidth="1.4"
    />
    <rect x="41" y="97" width="56" height="3.2" rx="1.6" fill="var(--empty-illustration-line-strong)" />
    <rect x="41" y="103" width="72" height="3.2" rx="1.6" fill="var(--empty-illustration-line)" />

    <circle cx="135" cy="105" r="12" fill="var(--empty-illustration-accent)" />
    <path d="M132 99.5l8 5.5-8 5.5v-11z" fill="var(--empty-illustration-contrast)" />

    <circle cx="124" cy="22" r="12" fill="var(--empty-illustration-accent)" />
    <path
      d="M124 16.2v11.6M118.2 22h11.6"
      stroke="var(--empty-illustration-contrast)"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
  </svg>
);

/** Empty cron jobs: a clock with circular dashes */
export const IllustrationEmptyCronjob = ({ size = 96 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 96 96"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    {/* outer ring */}
    <circle cx="48" cy="48" r="34" fill="var(--empty-illustration-layer)" />
    {/* clock face */}
    <circle
      cx="48"
      cy="48"
      r="26"
      fill="var(--empty-illustration-paper)"
      stroke="var(--empty-illustration-stroke)"
      strokeWidth="1.6"
    />
    {/* tick marks */}
    {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((deg) => (
      <line
        key={deg}
        x1="48"
        y1="25"
        x2="48"
        y2="28"
        stroke="var(--empty-illustration-stroke-strong)"
        strokeWidth="1.4"
        strokeLinecap="round"
        transform={`rotate(${deg} 48 48)`}
      />
    ))}
    {/* hour hand */}
    <line
      x1="48"
      y1="48"
      x2="48"
      y2="33"
      stroke="var(--empty-illustration-accent)"
      strokeWidth="2.6"
      strokeLinecap="round"
    />
    {/* minute hand */}
    <line
      x1="48"
      y1="48"
      x2="59"
      y2="42"
      stroke="var(--empty-illustration-accent)"
      strokeWidth="2"
      strokeLinecap="round"
    />
    {/* center dot */}
    <circle cx="48" cy="48" r="2.5" fill="var(--empty-illustration-accent)" />
    {/* small recurring arrows */}
    <path
      d="M72 54a26 26 0 0 1-8 12"
      stroke="var(--empty-illustration-stroke-strong)"
      strokeWidth="1.8"
      strokeLinecap="round"
      fill="none"
    />
    <path
      d="M64 66l0.5-4 3.5 1"
      stroke="var(--empty-illustration-stroke-strong)"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </svg>
);

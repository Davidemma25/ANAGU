export default function IsometricLandCitySvg() {
  return (
    <svg
      viewBox="0 0 1120 340"
      className="w-full h-auto block select-none"
      role="img"
      aria-label="Isometric neighborhood illustration showing surveyed land parcels, buildings, and verified owner boundary pins"
    >
      {/* Isometric Cadastral Parcel Grid Lines */}
      <g stroke="#D9BE4C" strokeWidth="1.2" fill="none">
        <path d="M40 320 L560 120 L1080 320" />
        <path d="M120 340 L560 165 L1000 340" />
        <path d="M220 340 L560 205 L900 340" />
        <path d="M160 265 L400 340" />
        <path d="M330 200 L690 340" />
        <path d="M560 120 L560 340" />
        <path d="M790 200 L430 340" />
        <path d="M960 265 L720 340" />
      </g>

      {/* Subtle Parcel Plots (White Isometric Bases) */}
      <g stroke="#1F2421" strokeWidth="1.4" strokeLinejoin="round">
        {/* Left Tower Plot */}
        <polygon points="270,285 375,245 480,285 375,325" fill="#FFFFFF" />
        <polygon points="282,285 375,250 468,285 375,320" fill="#F8FAFC" stroke="#94A3B8" strokeWidth="1" />

        {/* Mid-Left Survey Office Plot */}
        <polygon points="445,260 515,232 585,260 515,288" fill="#FFFFFF" />

        {/* Mid-Right Pitched House Plot */}
        <polygon points="575,275 660,242 745,275 660,308" fill="#FFFFFF" />

        {/* Right Registry Tower Plot */}
        <polygon points="735,292 830,255 925,292 830,329" fill="#FFFFFF" />
      </g>

      {/* Dashed Parcel Survey Boundaries */}
      <g stroke="#1F2421" strokeWidth="1" strokeDasharray="4 4" fill="none" opacity="0.65">
        <polygon points="150,315 245,278 335,315 245,342" />
        <polygon points="880,315 965,282 1050,315 965,342" />
      </g>

      {/* Far Left Low Pavilion */}
      <g stroke="#1F2421" strokeWidth="1.5" strokeLinejoin="round">
        <polygon points="180,310 225,292 225,322 180,340" fill="#FFFFFF" />
        <polygon points="225,292 270,310 270,340 225,322" fill="#2A2E2B" />
        <polygon points="180,310 225,292 270,310 225,328" fill="#FFFFFF" />
        <line x1="192" y1="318" x2="215" y2="309" stroke="#1F2421" strokeWidth="1.2" />
        <line x1="192" y1="326" x2="215" y2="317" stroke="#1F2421" strokeWidth="1.2" />
      </g>

      {/* Building 1: Tall Stepped Civic Tower (Left-Center) */}
      <g stroke="#1F2421" strokeWidth="1.6" strokeLinejoin="round">
        {/* Main Lower Block */}
        <polygon points="325,180 375,160 375,282 325,302" fill="#FFFFFF" />
        <polygon points="375,160 425,180 425,302 375,282" fill="#E6E8E6" />
        <polygon points="325,180 375,160 425,180 375,200" fill="#FFFFFF" />

        {/* Upper Tier */}
        <polygon points="340,148 375,134 375,168 340,182" fill="#FFFFFF" />
        <polygon points="375,134 410,148 410,182 375,168" fill="#D5D8D5" />
        <polygon points="340,148 375,134 410,148 375,162" fill="#FFFFFF" />

        {/* Crown Cap */}
        <polygon points="354,126 375,117 375,137 354,146" fill="#FFFFFF" />
        <polygon points="375,117 396,126 396,146 375,137" fill="#2A2E2B" />
        <polygon points="354,126 375,117 396,126 375,135" fill="#FFFFFF" />

        {/* Left Face Windows */}
        {[196, 212, 228, 244, 260, 276].map((y, idx) => (
          <g key={`b1l-${idx}`} fill="#1F2421" stroke="none">
            <polygon points={`334,${y} 344,${y - 4} 344,${y + 5} 334,${y + 9}`} />
            <polygon points={`352,${y - 7} 362,${y - 11} 362,${y - 2} 352,${y + 2}`} />
          </g>
        ))}

        {/* Right Face Windows */}
        {[196, 212, 228, 244, 260, 276].map((y, idx) => (
          <g key={`b1r-${idx}`} fill="#1F2421" stroke="none">
            <polygon points={`386,${y - 11} 396,${y - 7} 396,${y + 2} 386,${y - 2}`} />
            <polygon points={`404,${y - 4} 414,${y} 414,${y + 9} 404,${y + 5}`} />
          </g>
        ))}
      </g>

      {/* Building 2: Modern Survey Office (Center-Left) */}
      <g stroke="#1F2421" strokeWidth="1.5" strokeLinejoin="round">
        <polygon points="478,200 515,185 515,255 478,270" fill="#FFFFFF" />
        <polygon points="515,185 552,200 552,270 515,255" fill="#E6E8E6" />
        <polygon points="478,200 515,185 552,200 515,215" fill="#FFFFFF" />
        {/* Lower Side Annex */}
        <polygon points="515,244 552,259 552,277 515,262" fill="#2A2E2B" />
        <polygon points="515,244 548,231 580,244 548,257" fill="#FFFFFF" />
        {/* Windows */}
        {[212, 226, 240].map((y, idx) => (
          <g key={`b2-${idx}`} fill="#1F2421" stroke="none">
            <polygon points={`487,${y} 496,${y - 4} 496,${y + 4} 487,${y + 8}`} />
            <polygon points={`502,${y - 6} 510,${y - 9} 510,${y - 1} 502,${y + 2}`} />
          </g>
        ))}
      </g>

      {/* Building 3: Pitched-Roof Residential Parcel Home (Center-Right) */}
      <g stroke="#1F2421" strokeWidth="1.6" strokeLinejoin="round">
        {/* House Walls */}
        <polygon points="615,215 660,197 660,265 615,283" fill="#FFFFFF" />
        <polygon points="660,197 705,215 705,283 660,265" fill="#E6E8E6" />
        {/* Pitched Roof */}
        <polygon points="611,216 660,170 660,198 615,216" fill="#FFFFFF" />
        <polygon points="660,170 709,216 705,216 660,198" fill="#1F2421" />
        {/* Door & Windows */}
        <polygon points="632,255 644,250 644,271 632,276" fill="#1F2421" stroke="none" />
        <polygon points="673,222 686,227 686,240 673,235" fill="#1F2421" stroke="none" />
        <polygon points="626,226 640,220 640,234 626,240" fill="#1F2421" stroke="none" />
      </g>

      {/* Building 4: Tall Registry & Blockchain Verification Tower (Right) */}
      <g stroke="#1F2421" strokeWidth="1.6" strokeLinejoin="round">
        <polygon points="778,175 830,154 830,285 778,306" fill="#FFFFFF" />
        <polygon points="830,154 882,175 882,306 830,285" fill="#2A2E2B" />
        <polygon points="778,175 830,154 882,175 830,196" fill="#FFFFFF" />

        {/* Left Face Clean Windows */}
        {[192, 210, 228, 246, 264].map((y, idx) => (
          <g key={`b4l-${idx}`} fill="#1F2421" stroke="none">
            <polygon points={`789,${y} 800,${y - 4} 800,${y + 6} 789,${y + 10}`} />
            <polygon points={`808,${y - 8} 819,${y - 12} 819,${y - 2} 808,${y + 2}`} />
          </g>
        ))}

        {/* Right Face Contrasting Light Windows */}
        {[192, 210, 228, 246, 264].map((y, idx) => (
          <g key={`b4r-${idx}`} fill="#FFFFFF" stroke="none">
            <polygon points={`841,${y - 12} 852,${y - 8} 852,${y + 2} 841,${y - 2}`} />
            <polygon points={`860,${y - 4} 871,${y} 871,${y + 10} 860,${y + 6}`} />
          </g>
        ))}
      </g>

      {/* Far Right Corner Pavilion */}
      <g stroke="#1F2421" strokeWidth="1.5" strokeLinejoin="round">
        <polygon points="920,305 965,287 965,317 920,335" fill="#FFFFFF" />
        <polygon points="965,287 1010,305 1010,335 965,317" fill="#E6E8E6" />
        <polygon points="920,305 965,287 1010,305 965,323" fill="#FFFFFF" />
      </g>

      {/* Stylized Isometric Trees Lining Parcel Corridors */}
      {[
        { x: 295, y: 282 },
        { x: 455, y: 278 },
        { x: 580, y: 280 },
        { x: 730, y: 275 },
        { x: 900, y: 288 },
        { x: 432, y: 315 },
        { x: 750, y: 316 },
      ].map((t, idx) => (
        <g key={`tree-${idx}`} stroke="#1F2421" strokeWidth="1.3">
          <line x1={t.x} y1={t.y} x2={t.x} y2={t.y + 16} />
          <circle cx={t.x} cy={t.y - 4} r="10" fill="#FFFFFF" />
          <circle cx={t.x - 4} cy={t.y - 6} r="4" fill="#FDE878" stroke="none" />
        </g>
      ))}

      {/* Floating Map-Pin Markers (Cadastral Land Zone Checkpoints) */}
      {[
        { x: 225, y: 210, stemBottom: 292, label: 'S' },
        { x: 375, y: 54, stemBottom: 117, label: 'C' },
        { x: 602, y: 170, stemBottom: 235, label: 'O' },
        { x: 830, y: 88, stemBottom: 154, label: 'R' },
      ].map((pin, idx) => (
        <g key={`pin-${idx}`}>
          <line
            x1={pin.x}
            y1={pin.y + 22}
            x2={pin.x}
            y2={pin.stemBottom}
            stroke="#1F2421"
            strokeWidth="1.5"
            strokeDasharray="2.5 3.5"
          />
          <circle cx={pin.x} cy={pin.stemBottom} r="2.2" fill="#1F2421" />
          {/* Teardrop Map Pin */}
          <path
            d={`M ${pin.x} ${pin.y + 22} C ${pin.x - 14} ${pin.y + 10}, ${pin.x - 16} ${pin.y - 16}, ${pin.x} ${pin.y - 16} C ${pin.x + 16} ${pin.y - 16}, ${pin.x + 14} ${pin.y + 10}, ${pin.x} ${pin.y + 22} Z`}
            fill="#FFFFFF"
            stroke="#1F2421"
            strokeWidth="1.5"
          />
          <circle cx={pin.x} cy={pin.y - 1} r="8.5" fill="#1F2421" />
          {/* Minimalist Avatar / Initial Silhouette inside Pin */}
          <circle cx={pin.x} cy={pin.y - 3.5} r="2.6" fill="#FFFFFF" />
          <path
            d={`M ${pin.x - 4.8} ${pin.y + 4.5} C ${pin.x - 4.8} ${pin.y + 1}, ${pin.x + 4.8} ${pin.y + 1}, ${pin.x + 4.8} ${pin.y + 4.5}`}
            fill="#FFFFFF"
          />
        </g>
      ))}
    </svg>
  );
}

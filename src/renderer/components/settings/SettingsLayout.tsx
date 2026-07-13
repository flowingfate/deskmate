import React from 'react';

interface SettingsLayoutProps {
  icon: React.ReactNode;
  title: string;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

const BG = (
  <svg
    className="absolute right-1 bottom-0 h-8 -z-50 pointer-events-none opacity-100"
    aria-hidden="true"
    viewBox="0 0 307 358"
  >
    <path d="M169.34 357.529H139.84L147.601 169.529H159.34L169.34 357.529Z" fill="#D6D6E3" />
    <path d="M153.231 175.259C157.859 175.259 161.611 171.507 161.611 166.879C161.611 162.25 157.859 158.499 153.231 158.499C148.603 158.499 144.851 162.25 144.851 166.879C144.851 171.507 148.603 175.259 153.231 175.259Z" fill="black" />
    <g className="motion-safe:animate-[spin_10s_linear_infinite] transform-view origin-[49.91%_46.61%]">
      <path d="M165.441 120.229C164.651 124.609 161.951 133.859 153.231 133.629C150.02 133.48 146.998 132.07 144.822 129.705C142.645 127.34 141.492 124.21 141.611 120.999L144.131 30.3385L144.941 0.778531C144.941 0.778531 149.261 -7.40146 153.561 29.2685V29.3985L165.491 116.399C165.675 117.67 165.658 118.962 165.441 120.229Z" fill="#D6D6E3" />
      <path d="M159.631 129.019H146.821V156.429H159.631V129.019Z" fill="#D6D6E3" />
      <path d="M158.251 149.919H148.391V161.949H158.251V149.919Z" fill="white" />
      <path d="M153.581 29.4085C149.091 28.1085 146.041 29.0985 144.131 30.3485L144.941 0.788544C144.941 0.788544 149.261 -7.39146 153.561 29.2785L153.581 29.4085Z" fill="black" />
      <path d="M159.631 137.209V156.409H146.821V137.599C150.883 135.832 155.469 135.693 159.631 137.209Z" fill="black" />
      <path d="M189.771 198.299C186.181 195.669 179.041 189.189 183.071 181.449C184.611 178.626 187.205 176.527 190.286 175.609C193.368 174.691 196.687 175.029 199.521 176.549L279.901 218.549L306.111 232.239C306.111 232.239 311.571 239.709 276.731 227.499H276.601L193.211 200.109C191.976 199.691 190.815 199.08 189.771 198.299Z" fill="#D6D6E3" />
      <path d="M165.421 165.703L159.805 177.217L184.441 189.232L190.057 177.719L165.421 165.703Z" fill="#D6D6E3" />
      <path d="M166.272 178.832L170.594 169.97L159.782 164.696L155.459 173.558L166.272 178.832Z" fill="white" />
      <path d="M276.631 227.458C279.771 223.998 280.221 220.819 279.931 218.549L306.141 232.238C306.141 232.238 311.601 239.709 276.761 227.499L276.631 227.458Z" fill="black" />
      <path d="M177.081 185.639L159.771 177.209L165.381 165.699L182.311 173.949C182.122 178.37 180.251 182.551 177.081 185.639Z" fill="black" />
      <path d="M116.651 198.299C120.241 195.669 127.381 189.189 123.351 181.449C121.811 178.626 119.217 176.527 116.136 175.609C113.054 174.691 109.734 175.029 106.901 176.549L26.521 218.549L0.310932 232.239C0.310932 232.239 -5.14906 239.709 29.6909 227.499H29.8209L113.211 200.109C114.446 199.691 115.607 199.08 116.651 198.299Z" fill="#D6D6E3" />
      <path d="M141.031 165.704L116.395 177.72L122.011 189.233L146.646 177.217L141.031 165.704Z" fill="#D6D6E3" />
      <path d="M150.999 173.551L146.677 164.689L135.865 169.962L140.187 178.824L150.999 173.551Z" fill="white" />
      <path d="M29.8209 227.458C26.6809 223.998 26.231 220.819 26.521 218.549L0.310932 232.238C0.310932 232.238 -5.14906 239.709 29.6909 227.499L29.8209 227.458Z" fill="black" />
      <path d="M129.371 185.639L146.641 177.209L141.031 165.699L124.101 173.949C124.3 178.375 126.186 182.558 129.371 185.639Z" fill="black" />
    </g>
  </svg>
);

const SettingsLayout: React.FC<SettingsLayoutProps> = ({
  icon,
  title,
  badges,
  actions,
  children,
  className,
}) => {
  className = 'flex-1 min-h-0 overflow-y-auto ' + (className || '');
  return (
    <div
      className="flex flex-col h-full"
      data-dbg="settings-layout"
    >
      <div
        className="flex justify-between items-center pl-6 pr-7.75 h-11.25 shrink-0 border-b border-black/7 relative"
        data-dbg="settings-layout-header"
      >
        {BG}
        <div className="flex items-center gap-2">
          <span className="flex items-center justify-center w-5 h-5 shrink-0">{icon}</span>
          <span className="text-base font-semibold leading-5.5 text-black">{title}</span>
          {badges && <div className="flex items-center gap-1.5 flex-wrap">{badges}</div>}
        </div>
        {actions && <div className="flex items-center shrink-0">{actions}</div>}
      </div>
      <div className={className} data-dbg="settings-layout-content">
        {children}
      </div>
    </div>
  );
};

export default SettingsLayout;

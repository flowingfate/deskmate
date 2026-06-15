import React from 'react';
import { Button } from '@/shadcn/button';

interface NavItemProps {
  icon?: string | React.ReactNode;
  label?: string | React.ReactNode;
  isActive?: boolean;
  onClick?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  ariaLabel?: string;
  disabled?: boolean;
  title?: string;
  role?: string;
  tabIndex?: number;
}

const NavItem: React.FC<NavItemProps> = ({
  icon,
  label,
  isActive = false,
  onClick,
  onKeyDown,
  ariaLabel,
  disabled = false,
  title,
  role,
  tabIndex,
}) => {
  const handleClick = () => {
    if (!disabled && onClick) {
      onClick();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (onKeyDown) {
      onKeyDown(e);
    } else if ((e.key === 'Enter' || e.key === ' ') && !disabled && onClick) {
      e.preventDefault();
      onClick();
    }
  };

  const computedAriaLabel = ariaLabel || (typeof label === 'string' ? label : undefined);

  return (
    <Button
      variant={isActive ? 'secondary' : 'ghost'}
      className="w-full"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-label={computedAriaLabel}
      disabled={disabled}
      title={title}
      role={role}
      tabIndex={tabIndex}
    >
      <div className="flex items-center gap-1 min-w-0 flex-1 h-10">
        {icon && (
          <div className="flex items-center justify-center w-6 h-6 shrink-0 overflow-visible">
            {icon}
          </div>
        )}
        {label && (
          <span className={`flex flex-col justify-center items-start py-2.5 pl-0.5 pr-2.5 min-w-0 flex-1 h-10 leading-5 truncate ${isActive ? 'font-medium' : 'font-normal text-sc-muted-foreground'}`}>
            {label}
          </span>
        )}
      </div>
    </Button>
  );
};

export default NavItem;
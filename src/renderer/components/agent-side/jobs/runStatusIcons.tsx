import React from 'react';

/** Spinning ring; running schedule run. */
export const ExecutingIcon: React.FC = () => (
  <svg
    data-dbg="run-status-executing"
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="animate-spin"
  >
    <circle cx="10" cy="10" r="9" stroke="black" strokeOpacity="0.15" strokeWidth="2" />
    <path
      d="M10 1C5.02944 1 1 5.02944 1 10"
      stroke="#3B82F6"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

/** Solid checkmark; completed schedule run. */
export const CompletedIcon: React.FC = () => (
  <svg
    data-dbg="run-status-completed"
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle cx="10" cy="10" r="9" fill="#10B981" />
    <path
      d="M6 10.5L8.5 13L14 7.5"
      stroke="white"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** Pause-style icon; interrupted (e.g. app quit) schedule run. */
export const InterruptedIcon: React.FC = () => (
  <svg
    data-dbg="run-status-interrupted"
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle cx="10" cy="10" r="9" fill="#9CA3AF" />
    <rect x="7" y="6" width="2" height="8" fill="white" />
    <rect x="11" y="6" width="2" height="8" fill="white" />
  </svg>
);

/** Cross-mark; failed schedule run. */
export const FailedIcon: React.FC = () => (
  <svg
    data-dbg="run-status-failed"
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle cx="10" cy="10" r="9" fill="#EF4444" />
    <path
      d="M7 7L13 13M13 7L7 13"
      stroke="white"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

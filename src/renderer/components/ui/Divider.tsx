import React from 'react';

const Divider: React.FC = () => {
  return (
    <div className="flex items-center justify-center w-full h-2.25 min-h-2 flex-none self-stretch grow-0 pt-1.25 pb-1">
      <div className="box-border w-full h-0 border-b border-black/10 flex-none self-stretch grow" />
    </div>
  );
};

export default Divider;
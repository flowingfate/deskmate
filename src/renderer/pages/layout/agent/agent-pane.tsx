import React from 'react';

interface Props {
  children: React.ReactNode;
  className?: string;
}

function mix(props: Props, cls: string) {
  if (props.className) {
    return cls + ' ' + props.className;
  }
  return cls;
}

function Head(props: Props) {
  return (
    <header className={mix(props, 'h-[45px] shrink-0 border-b border-black/7 flex items-center justify-between pl-4 pr-[31px]')}>
      {props.children}
    </header>
  )
}

function Body(props: Props) {
  return (
    <div className={mix(props, 'flex-1 min-h-0')}>
      {props.children}
    </div>
  );
}

function AgentPane(props: Props) {
  return (
    <div className={mix(props, 'flex flex-col overflow-hidden rounded-lg border border-black/7 shadow-[0px_2px_6px_rgba(0,0,0,0.05)]')}>
      {props.children}
    </div>
  );
}

AgentPane.Head = Head;
AgentPane.Body = Body;

export default AgentPane;


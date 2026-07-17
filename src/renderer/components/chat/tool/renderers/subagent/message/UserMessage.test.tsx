// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createUserMessage } from '@shared/utils/messageFactory';
import { UserMessage } from './UserMessage';

const REMINDER = '<system-reminder>Before ending this delegated run, call submit_result with the formal outcome.</system-reminder>';

afterEach(cleanup);

describe('subagent transcript UserMessage', () => {
  it('removes system reminder blocks from visible user content', () => {
    render(<UserMessage message={createUserMessage({ content: `Add rollout risks.\n\n${REMINDER}` })} />);

    expect(screen.getByText('Add rollout risks.')).toBeInTheDocument();
    expect(screen.queryByText(/submit_result/)).not.toBeInTheDocument();
  });

  it('does not render a reminder-only message', () => {
    const { container } = render(<UserMessage message={createUserMessage({ content: REMINDER })} />);

    expect(container).toBeEmptyDOMElement();
  });
});

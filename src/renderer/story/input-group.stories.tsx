import type { Story } from '@ladle/react';
import { Search, Mail, Check } from 'lucide-react';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/shadcn/input-group';

export default { title: 'Shadcn / InputGroup' };

export const LeadingIcon: Story = () => (
  <InputGroup className="w-80">
    <InputGroupAddon>
      <Search />
    </InputGroupAddon>
    <InputGroupInput placeholder="Search agents…" />
  </InputGroup>
);

export const TrailingButton: Story = () => (
  <InputGroup className="w-80">
    <InputGroupAddon>
      <Mail />
    </InputGroupAddon>
    <InputGroupInput placeholder="email@example.com" />
    <InputGroupAddon align="inline-end">
      <InputGroupButton variant="default" size="sm">
        <Check /> Verify
      </InputGroupButton>
    </InputGroupAddon>
  </InputGroup>
);
